import { describe, expect, it } from "vitest";
import { getTool, listTools } from "./registry";

describe("tool-registry", () => {
  it("lista ferramentas com manifesto completo", () => {
    const tools = listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.id).toBeTruthy();
      expect(tool.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(tool.risk).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.outputSchema).toBeTruthy();
      expect(tool.policy.timeoutMs).toBeGreaterThan(0);
      expect(tool.policy.maxOutputBytes).toBeGreaterThan(0);
    }
  });

  it("expõe shell.run", () => {
    const shell = getTool("shell.run");
    expect(shell?.id).toBe("shell.run");
    expect(shell?.policy.requiresCwdLock).toBe(true);
  });

  it("expõe code.context como leitura", () => {
    const tool = getTool("code.context");
    expect(tool?.risk).toBe("read");
    expect(tool?.policy.defaultTier).toBe("auto");
    expect(tool?.policy.requiresCwdLock).toBe(false);
  });
});
