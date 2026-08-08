import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { WorkspaceRequest } from "./workspace-policy";

const agentIds = ["Hermes", "Planner", "Developer", "Builder"] as const;
const riskSchema = z.enum(["read", "network", "write", "system"]);
const workspaceModeSchema = z.enum([
  "optional_existing",
  "existing_repo",
  "new_project",
]);
const mutationModeSchema = z.enum(["none", "controlled"]);
const memoryPolicySchema = z.enum(["off", "manual", "consent"]);

const modelSchema = z.object({ fallback: z.array(z.string()).default([]) }).strict();
const toolSchema = z.object({ risk: riskSchema }).strict();
const agentSchema = z
  .object({
    model: z.string().optional(),
    workspace_mode: workspaceModeSchema,
    mutation_mode: mutationModeSchema,
    tools: z.array(z.string()).min(1),
    max_risk: riskSchema,
    memory_policy: memoryPolicySchema,
    budget_usd: z.number().finite().positive(),
    timeout_ms: z.number().int().positive(),
  })
  .strict();

const yamlSchema = z
  .object({
    version: z.number().int().positive(),
    default_model: z.string(),
    models: z.record(z.string(), modelSchema),
    tools: z.record(z.string(), toolSchema),
    agents: z.record(z.string(), agentSchema),
  })
  .strict();

export type AgentRisk = z.infer<typeof riskSchema>;
export type AgentWorkspaceMode = z.infer<typeof workspaceModeSchema>;
export type AgentMutationMode = z.infer<typeof mutationModeSchema>;
export type AgentMemoryPolicy = z.infer<typeof memoryPolicySchema>;

export interface AgentDefinition {
  id: (typeof agentIds)[number];
  model: string;
  workspaceMode: AgentWorkspaceMode;
  mutationMode: AgentMutationMode;
  tools: string[];
  maxRisk: AgentRisk;
  memoryPolicy: AgentMemoryPolicy;
  budgetUsd: number;
  timeoutMs: number;
}

export interface AgentCatalog {
  version: number;
  defaultModel: string;
  models: Record<string, { fallback: string[] }>;
  tools: Record<string, { risk: AgentRisk }>;
  agents: Record<(typeof agentIds)[number], AgentDefinition>;
}

const riskRank: Record<AgentRisk, number> = {
  read: 0,
  network: 1,
  write: 2,
  system: 3,
};

function fail(message: string): never {
  throw new Error(`Invalid agent catalog: ${message}`);
}

function assertNoFallbackCycles(models: Record<string, { fallback: string[] }>) {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (model: string) => {
    if (visiting.has(model)) fail(`fallback cycle at ${model}`);
    if (visited.has(model)) return;
    visiting.add(model);
    for (const fallback of models[model].fallback) {
      if (!models[fallback]) fail(`unknown fallback model ${fallback}`);
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
  tools: Record<string, { risk: AgentRisk }>,
  defaultModel: string,
) {
  const model = agent.model ?? defaultModel;
  if (!models[model]) fail(`${id} references unknown model ${model}`);

  for (const toolId of agent.tools) {
    const tool = tools[toolId];
    if (!tool) fail(`${id} references unknown tool ${toolId}`);
    if (riskRank[tool.risk] > riskRank[agent.max_risk]) {
      fail(`${id} allows tool risk above max risk`);
    }
    if (agent.mutation_mode === "none" && tool.risk !== "read") {
      fail(`${id} non-mutating mode allows ${toolId}`);
    }
  }
  if (agent.mutation_mode === "none" && agent.max_risk !== "read") {
    fail(`${id} non-mutating mode has elevated max risk`);
  }
}

/** Pure validation boundary for the safe-core manifest. */
export function loadAgentCatalogFromYaml(raw: string): AgentCatalog {
  const parsed = yamlSchema.parse(parseYaml(raw));
  if (Object.keys(parsed.models).length === 0 || Object.keys(parsed.tools).length === 0) {
    fail("models and tools must not be empty");
  }
  if (!parsed.models[parsed.default_model]) fail("unknown default model");
  assertNoFallbackCycles(parsed.models);

  const actualAgentIds = Object.keys(parsed.agents).sort();
  if (actualAgentIds.join(",") !== [...agentIds].sort().join(",")) {
    fail("must define exactly Hermes, Planner, Developer and Builder");
  }

  const agents = {} as AgentCatalog["agents"];
  for (const id of agentIds) {
    const agent = parsed.agents[id];
    assertAgentCompatibility(agent, id, parsed.models, parsed.tools, parsed.default_model);
    agents[id] = {
      id,
      model: agent.model ?? parsed.default_model,
      workspaceMode: agent.workspace_mode,
      mutationMode: agent.mutation_mode,
      tools: [...agent.tools],
      maxRisk: agent.max_risk,
      memoryPolicy: agent.memory_policy,
      budgetUsd: agent.budget_usd,
      timeoutMs: agent.timeout_ms,
    };
  }

  return { version: parsed.version, defaultModel: parsed.default_model, models: parsed.models, tools: parsed.tools, agents };
}

export function loadAgentCatalogFromDisk(): AgentCatalog {
  return loadAgentCatalogFromYaml(
    readFileSync(resolve(process.cwd(), "config/agents.yaml"), "utf8"),
  );
}

export function getAgent(catalog: AgentCatalog, agentId: string): AgentDefinition | null {
  return catalog.agents[agentId as (typeof agentIds)[number]] ?? null;
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
