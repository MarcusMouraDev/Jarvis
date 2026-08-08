import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAgent,
  loadAgentCatalogFromYaml,
  resolveWorkspaceForAgent,
} from "./agent-catalog";

const validCatalog = `
version: 1
default_model: gemini
models:
  gemini: { fallback: [codex-openai] }
  codex-openai: { fallback: [] }
tools:
  code.context: { risk: read }
  terminal.read: { risk: read }
  terminal.run: { risk: system }
  file.patch: { risk: system }
agents:
  Hermes:
    model: gemini
    workspace_mode: optional_existing
    mutation_mode: controlled
    tools: [code.context, terminal.read, terminal.run, file.patch]
    max_risk: system
    memory_policy: manual
    budget_usd: 2
    timeout_ms: 120000
  Planner:
    model: gemini
    workspace_mode: optional_existing
    mutation_mode: none
    tools: [code.context]
    max_risk: read
    memory_policy: off
    budget_usd: 1
    timeout_ms: 1
  Developer:
    model: gemini
    workspace_mode: existing_repo
    mutation_mode: controlled
    tools: [code.context]
    max_risk: read
    memory_policy: manual
    budget_usd: 1
    timeout_ms: 1
  Builder:
    model: gemini
    workspace_mode: new_project
    mutation_mode: controlled
    tools: [code.context]
    max_risk: read
    memory_policy: consent
    budget_usd: 1
    timeout_ms: 1
`;

describe("agent catalog", () => {
  it("loads the safe-core manifest without consulting legacy profiles", () => {
    const raw = readFileSync(
      resolve(__dirname, "../../config/agents.yaml"),
      "utf8",
    );

    const catalog = loadAgentCatalogFromYaml(raw);

    expect(catalog.defaultModel).toBe("gemini");
    expect(Object.keys(catalog.agents)).toEqual([
      "Hermes",
      "Planner",
      "Developer",
      "Builder",
    ]);
    expect(getAgent(catalog, "Planner")).toMatchObject({
      mutationMode: "none",
      maxRisk: "read",
      tools: ["code.context", "terminal.read"],
    });
  });

  it.each([
    ["unknown model", validCatalog.replace("model: gemini", "model: unknown")],
    ["unknown tool", validCatalog.replace("code.context", "unknown.tool")],
    [
      "fallback cycle",
      validCatalog.replace(
        "codex-openai: { fallback: [] }",
        "codex-openai: { fallback: [gemini] }",
      ),
    ],
    ["zero budget", validCatalog.replace("budget_usd: 2", "budget_usd: 0")],
    ["zero timeout", validCatalog.replace("timeout_ms: 120000", "timeout_ms: 0")],
    ["tool risk above agent maximum", validCatalog.replace("max_risk: system", "max_risk: read")],
  ])("rejects %s", (_name, raw) => {
    expect(() => loadAgentCatalogFromYaml(raw)).toThrow();
  });

  it("rejects tools that can mutate from a non-mutating agent", () => {
    const raw = validCatalog
      .replace("mutation_mode: controlled", "mutation_mode: none")
      .replace("max_risk: system", "max_risk: read");

    expect(() => loadAgentCatalogFromYaml(raw)).toThrow();
  });

  it("enforces the workspace mode selected by the agent", () => {
    const catalog = loadAgentCatalogFromYaml(validCatalog);

    expect(() =>
      resolveWorkspaceForAgent(catalog, "Hermes", { kind: "new", name: "app" }),
    ).toThrow();
  });
});
