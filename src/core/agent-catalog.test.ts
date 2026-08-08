import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertResolvedWorkspaceForAgent,
  getAgent,
  loadAgentCatalogFromYaml,
  resolveWorkspaceForAgent,
} from "./agent-catalog";
import { resolveWorkspace } from "./workspace-policy";

const validCatalog = `
version: 1
default_model: gemini
models:
  gemini: { provider: google, costs_extra: true, fallback: [codex-openai] }
  codex-openai: { provider: openai, costs_extra: true, fallback: [] }
agents:
  Hermes:
    model: gemini
    workspace_mode: optional_existing
    mutation_mode: controlled
    tools: [code.context, terminal.read, terminal.run, file.patch]
    memory_policy: manual
    budget_usd: 2
    timeout_ms: 120000
  Planner:
    model: gemini
    workspace_mode: optional_existing
    mutation_mode: none
    tools: [code.context]
    memory_policy: off
    budget_usd: 1
    timeout_ms: 1
  Developer:
    model: gemini
    workspace_mode: existing_repo
    mutation_mode: controlled
    tools: [code.context]
    memory_policy: manual
    budget_usd: 1
    timeout_ms: 1
  Builder:
    model: gemini
    workspace_mode: new_project
    mutation_mode: controlled
    tools: [code.context]
    memory_policy: consent
    budget_usd: 1
    timeout_ms: 1
`;

const tempPaths: string[] = [];

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("agent catalog", () => {
  it("loads the safe-core manifest without consulting legacy profiles", () => {
    const raw = readFileSync(
      resolve(__dirname, "../../config/agents.yaml"),
      "utf8",
    );

    const catalog = loadAgentCatalogFromYaml(raw);

    expect(catalog.defaultModel).toBe("local");
    expect(catalog.models.local).toMatchObject({
      provider: "local",
      costsExtra: false,
      fallback: [],
    });
    expect(Object.keys(catalog.agents)).toEqual([
      "Hermes",
      "Planner",
      "Developer",
      "Builder",
    ]);
    expect(getAgent(catalog, "Planner")).toMatchObject({
      mutationMode: "none",
      tools: ["code.context", "terminal.read"],
      budgetUsd: 0,
    });
  });

  it.each([
    ["unknown model", validCatalog.replace("model: gemini", "model: unknown")],
    ["unknown tool", validCatalog.replace("code.context", "unknown.tool")],
    [
      "fallback cycle",
      validCatalog.replace(
        "codex-openai: { provider: openai, costs_extra: true, fallback: [] }",
        "codex-openai: { provider: openai, costs_extra: true, fallback: [gemini] }",
      ),
    ],
    ["negative budget", validCatalog.replace("budget_usd: 2", "budget_usd: -1")],
    ["zero timeout", validCatalog.replace("timeout_ms: 120000", "timeout_ms: 0")],
  ])("rejects %s", (_name, raw) => {
    expect(() => loadAgentCatalogFromYaml(raw)).toThrow();
  });

  it("rejects tools that can mutate from a non-mutating agent", () => {
    const raw = validCatalog
      .replace("mutation_mode: controlled", "mutation_mode: none");

    expect(() => loadAgentCatalogFromYaml(raw)).toThrow();
  });

  it("enforces the workspace mode selected by the agent", () => {
    const catalog = loadAgentCatalogFromYaml(validCatalog);

    expect(() =>
      resolveWorkspaceForAgent(catalog, "Hermes", { kind: "new", name: "app" }),
    ).toThrow();
  });

  it.each([
    [
      "an inherited model",
      validCatalog.replace("model: gemini", "model: toString"),
    ],
    [
      "an inherited tool",
      validCatalog.replace("tools: [code.context]", "tools: [constructor]"),
    ],
    [
      "an inherited fallback",
      validCatalog.replace("fallback: [codex-openai]", "fallback: [constructor]"),
    ],
  ])("rejects %s reference", (_name, raw) => {
    expect(() => loadAgentCatalogFromYaml(raw)).toThrow();
  });

  it("does not return an inherited agent", () => {
    const catalog = loadAgentCatalogFromYaml(validCatalog);
    const inheritedCatalog = {
      ...catalog,
      agents: Object.create({ toString: catalog.agents.Hermes }),
    } as typeof catalog;

    expect(getAgent(inheritedCatalog, "toString")).toBeNull();
  });

  it("requires an existing-repo agent to use a Git repository root", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "jarvis-agent-catalog-"));
    tempPaths.push(temporaryRoot);
    const root = realpathSync(temporaryRoot);
    const plainDirectory = join(root, "plain");
    const repository = join(root, "repository");
    const emptyGitDirectory = join(root, "empty-git-directory");
    const arbitraryGitFile = join(root, "arbitrary-git-file");
    mkdirSync(plainDirectory);
    execFileSync("git", ["init", "--quiet", repository]);
    mkdirSync(emptyGitDirectory);
    mkdirSync(join(emptyGitDirectory, ".git"));
    mkdirSync(arbitraryGitFile);
    writeFileSync(join(arbitraryGitFile, ".git"), "not a worktree\n");
    const catalog = loadAgentCatalogFromYaml(validCatalog);

    const plainWorkspace = resolveWorkspace(
      { kind: "existing", path: plainDirectory },
      { projectsRoot: root },
    );
    const repositoryWorkspace = resolveWorkspace(
      { kind: "existing", path: repository },
      { projectsRoot: root },
    );
    const emptyGitDirectoryWorkspace = resolveWorkspace(
      { kind: "existing", path: emptyGitDirectory },
      { projectsRoot: root },
    );
    const arbitraryGitFileWorkspace = resolveWorkspace(
      { kind: "existing", path: arbitraryGitFile },
      { projectsRoot: root },
    );

    expect(() =>
      assertResolvedWorkspaceForAgent(catalog, "Developer", plainWorkspace),
    ).toThrow();
    expect(
      assertResolvedWorkspaceForAgent(catalog, "Developer", repositoryWorkspace),
    ).toMatchObject({ id: "Developer" });
    expect(() =>
      assertResolvedWorkspaceForAgent(
        catalog,
        "Developer",
        emptyGitDirectoryWorkspace,
      ),
    ).toThrow();
    expect(() =>
      assertResolvedWorkspaceForAgent(catalog, "Developer", arbitraryGitFileWorkspace),
    ).toThrow();
  });

  it("fails closed when Git is unavailable", () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-agent-catalog-"));
    tempPaths.push(root);
    const projectsRoot = realpathSync(root);
    const repository = join(projectsRoot, "repository");
    execFileSync("git", ["init", "--quiet", repository]);
    const catalog = loadAgentCatalogFromYaml(validCatalog);
    const workspace = resolveWorkspace(
      { kind: "existing", path: repository },
      { projectsRoot },
    );

    expect(() =>
      assertResolvedWorkspaceForAgent(catalog, "Developer", workspace, {
        execFile: (() => {
          const error = new Error("git unavailable") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }) as typeof execFileSync,
      }),
    ).toThrow();
  });
});
