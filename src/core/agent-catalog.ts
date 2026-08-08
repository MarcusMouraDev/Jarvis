import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { getSafeToolManifest } from "./safe-tool-manifests";
import type { ResolvedWorkspace, WorkspaceRequest } from "./workspace-policy";

const agentIds = ["Hermes", "Planner", "Developer", "Builder"] as const;
const workspaceModeSchema = z.enum([
  "optional_existing",
  "existing_repo",
  "new_project",
]);
const mutationModeSchema = z.enum(["none", "controlled"]);
const memoryPolicySchema = z.enum(["off", "manual", "consent"]);

const modelSchema = z
  .object({
    provider: z.string().min(1),
    costs_extra: z.boolean(),
    fallback: z.array(z.string()).default([]),
  })
  .strict();
const agentSchema = z
  .object({
    model: z.string().optional(),
    workspace_mode: workspaceModeSchema,
    mutation_mode: mutationModeSchema,
    tools: z.array(z.string()).min(1),
    memory_policy: memoryPolicySchema,
    budget_usd: z.number().finite().nonnegative(),
    timeout_ms: z.number().int().positive(),
  })
  .strict();

const yamlSchema = z
  .object({
    version: z.number().int().positive(),
    default_model: z.string(),
    models: z.record(z.string(), modelSchema),
    agents: z.record(z.string(), agentSchema),
  })
  .strict();

export type AgentWorkspaceMode = z.infer<typeof workspaceModeSchema>;
export type AgentMutationMode = z.infer<typeof mutationModeSchema>;
export type AgentMemoryPolicy = z.infer<typeof memoryPolicySchema>;

export interface AgentDefinition {
  id: (typeof agentIds)[number];
  model: string;
  workspaceMode: AgentWorkspaceMode;
  mutationMode: AgentMutationMode;
  tools: string[];
  memoryPolicy: AgentMemoryPolicy;
  budgetUsd: number;
  timeoutMs: number;
}

export interface AgentCatalog {
  version: number;
  defaultModel: string;
  models: Record<
    string,
    { provider: string; costsExtra: boolean; fallback: string[] }
  >;
  agents: Record<(typeof agentIds)[number], AgentDefinition>;
}

export interface GitRepositoryValidationOptions {
  /** Test seam for the read-only Git probe. */
  execFile?: typeof execFileSync;
}

function fail(message: string): never {
  throw new Error(`Invalid agent catalog: ${message}`);
}

function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function assertNoFallbackCycles(models: Record<string, { fallback: string[] }>) {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (model: string) => {
    if (visiting.has(model)) fail(`fallback cycle at ${model}`);
    if (visited.has(model)) return;
    const definition = ownValue(models, model);
    if (!definition) fail(`unknown fallback model ${model}`);
    visiting.add(model);
    for (const fallback of definition.fallback) {
      if (!ownValue(models, fallback)) fail(`unknown fallback model ${fallback}`);
      visit(fallback);
    }
    visiting.delete(model);
    visited.add(model);
  };
  Object.keys(models).forEach(visit);
}

function assertAgentCompatibility(
  agent: z.infer<typeof agentSchema>,
  id: string,
  models: Record<string, { fallback: string[] }>,
  defaultModel: string,
) {
  const model = agent.model ?? defaultModel;
  if (!ownValue(models, model)) fail(`${id} references unknown model ${model}`);

  for (const toolId of agent.tools) {
    const tool = getSafeToolManifest(toolId);
    if (!tool) fail(`${id} references unknown tool ${toolId}`);
    if (agent.mutation_mode === "none" && tool.sideEffect !== "none") {
      fail(`${id} non-mutating mode allows ${toolId}`);
    }
  }
}

/** Pure validation boundary for the safe-core manifest. */
export function loadAgentCatalogFromYaml(raw: string): AgentCatalog {
  const parsed = yamlSchema.parse(parseYaml(raw));
  if (Object.keys(parsed.models).length === 0) fail("models must not be empty");
  if (!ownValue(parsed.models, parsed.default_model)) fail("unknown default model");
  assertNoFallbackCycles(parsed.models);

  const actualAgentIds = Object.keys(parsed.agents).sort();
  if (actualAgentIds.join(",") !== [...agentIds].sort().join(",")) {
    fail("must define exactly Hermes, Planner, Developer and Builder");
  }

  const models = Object.fromEntries(
    Object.entries(parsed.models).map(([id, model]) => [
      id,
      {
        provider: model.provider,
        costsExtra: model.costs_extra,
        fallback: [...model.fallback],
      },
    ]),
  );
  const agents = {} as AgentCatalog["agents"];
  for (const id of agentIds) {
    const agent = ownValue(parsed.agents, id);
    if (!agent) fail(`missing agent ${id}`);
    assertAgentCompatibility(agent, id, parsed.models, parsed.default_model);
    agents[id] = {
      id,
      model: agent.model ?? parsed.default_model,
      workspaceMode: agent.workspace_mode,
      mutationMode: agent.mutation_mode,
      tools: [...agent.tools],
      memoryPolicy: agent.memory_policy,
      budgetUsd: agent.budget_usd,
      timeoutMs: agent.timeout_ms,
    };
  }

  return { version: parsed.version, defaultModel: parsed.default_model, models, agents };
}

export function loadAgentCatalogFromDisk(): AgentCatalog {
  return loadAgentCatalogFromYaml(
    readFileSync(resolve(process.cwd(), "config/agents.yaml"), "utf8"),
  );
}

export function getAgent(catalog: AgentCatalog, agentId: string): AgentDefinition | null {
  return ownValue(catalog.agents, agentId) ?? null;
}

/** Validates the caller's requested workspace kind before it is resolved for a run. */
export function resolveWorkspaceForAgent(
  catalog: AgentCatalog,
  agentId: string,
  workspace: WorkspaceRequest,
): AgentDefinition {
  const agent = getAgent(catalog, agentId);
  if (!agent) fail(`unknown agent ${agentId}`);
  const allowedKinds: Record<AgentWorkspaceMode, WorkspaceRequest["kind"][]> = {
    optional_existing: ["none", "existing"],
    existing_repo: ["existing"],
    new_project: ["new"],
  };
  if (!allowedKinds[agent.workspaceMode].includes(workspace.kind)) {
    fail(`${agent.id} is incompatible with ${workspace.kind} workspace`);
  }
  return agent;
}

/** Applies post-resolution restrictions that require filesystem facts. */
export function assertResolvedWorkspaceForAgent(
  catalog: AgentCatalog,
  agentId: string,
  workspace: ResolvedWorkspace,
  options: GitRepositoryValidationOptions = {},
): AgentDefinition {
  const agent = resolveWorkspaceForAgent(catalog, agentId, workspace);
  if (agent.workspaceMode !== "existing_repo") return agent;

  if (workspace.kind !== "existing") fail(`${agent.id} requires an existing workspace`);
  let gitEntry;
  try {
    gitEntry = lstatSync(resolve(workspace.path, ".git"));
  } catch {
    fail(`${agent.id} requires a Git repository root`);
  }
  if (gitEntry.isSymbolicLink() || (!gitEntry.isDirectory() && !gitEntry.isFile())) {
    fail(`${agent.id} requires a Git repository root`);
  }
  let topLevel: string;
  try {
    topLevel = (options.execFile ?? execFileSync)(
      "git",
      ["-C", workspace.path, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", timeout: 3_000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    fail(`${agent.id} requires a Git repository root`);
  }
  try {
    if (realpathSync(topLevel) !== workspace.path) {
      fail(`${agent.id} requires a Git repository root`);
    }
  } catch {
    fail(`${agent.id} requires a Git repository root`);
  }
  return agent;
}
