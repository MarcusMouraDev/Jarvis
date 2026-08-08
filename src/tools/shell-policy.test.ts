import { describe, expect, it } from "vitest";
import { classifyCommand, tokenizeCommand } from "./shell-policy";

describe("shell-policy", () => {
  it("tokeniza aspas", () => {
    expect(tokenizeCommand(`echo "hello world"`)).toEqual(["echo", "hello world"]);
  });

  it("permite leitura na allowlist", () => {
    const c = classifyCommand("git status");
    expect(c.tier).toBe("auto");
    expect(c.reasons).toEqual([]);
  });

  it("permite npm run lint", () => {
    expect(classifyCommand("npm run lint").tier).toBe("auto");
    expect(classifyCommand("npm run build").tier).toBe("confirm");
  });

  it("exige confirmação para metacaracteres", () => {
    const c = classifyCommand("ls | wc -l");
    expect(c.tier).toBe("confirm");
    expect(c.reasons).toContain("encadeamento de shell");
  });

  it("exige confirmação fora da allowlist", () => {
    const c = classifyCommand("python script.py");
    expect(c.tier).toBe("confirm");
    expect(c.reasons.some((r) => r.includes("allowlist") || r.includes("aprovação"))).toBe(
      true,
    );
  });

  it("nega leitura de .env", () => {
    const c = classifyCommand("cat .env.local");
    expect(c.tier).toBe("deny");
    expect(c.reasons.join(" ")).toMatch(/\.env/);
  });

  it("nega path fora do root", () => {
    const c = classifyCommand("cat ../../etc/passwd");
    expect(c.tier).toBe("deny");
  });

  it("marca escrita/rede", () => {
    const c = classifyCommand("curl https://example.com");
    expect(c.tier).toBe("confirm");
    expect(c.reasons.some((r) => /escrita|rede/.test(r))).toBe(true);
  });
});
