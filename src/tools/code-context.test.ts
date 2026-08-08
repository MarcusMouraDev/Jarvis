import { describe, expect, it } from "vitest";
import { runCodeContext } from "./code-context";

describe("code-context", () => {
  it("nega caminhos bloqueados pela política", () => {
    const result = runCodeContext({ paths: [".env", "node_modules/pkg/index.js"] });
    expect(result.summaries[0]?.error).toBeTruthy();
    expect(result.summaries[1]?.error).toBeTruthy();
  });

  it("resume arquivos permitidos do repo", () => {
    const result = runCodeContext({ paths: ["package.json"] });
    expect(result.summaries[0]?.summary?.relPath).toBe("package.json");
    expect(result.summaries[0]?.error).toBeUndefined();
  });
});
