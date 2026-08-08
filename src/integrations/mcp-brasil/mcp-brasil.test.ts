import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkMcpBrasilAllowlist } from "./allowlist";
import { runMcpBrasilQuery } from "./run";

const originalFlag = process.env.JARVIS_MCP_BRASIL;

describe("mcp-brasil", () => {
  beforeEach(() => {
    delete process.env.JARVIS_MCP_BRASIL;
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.JARVIS_MCP_BRASIL;
    else process.env.JARVIS_MCP_BRASIL = originalFlag;
  });

  it("nega execução quando flag desligada", async () => {
    const result = await runMcpBrasilQuery({ tool: "bcb.selic", params: {} });
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.reason).toBe("mcp_brasil_disabled");
    }
  });

  it("permite tool allowlisted com flag ligada", async () => {
    process.env.JARVIS_MCP_BRASIL = "1";
    const result = await runMcpBrasilQuery({ tool: "bcb.selic", params: {} });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.output.source).toBeTruthy();
      expect(result.output.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.output.disclaimer).toContain("Não constitui aconselhamento");
    }
  });

  it("nega parâmetro fora da allowlist", () => {
    const check = checkMcpBrasilAllowlist({
      tool: "bcb.selic",
      params: { year: 2024 },
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe("param_not_allowlisted:year");
  });

  it("permite ibge.population com year e uf", () => {
    const check = checkMcpBrasilAllowlist({
      tool: "ibge.population",
      params: { year: 2024, uf: "SP" },
    });
    expect(check.allowed).toBe(true);
  });
});
