import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCodeContext } from "./code-context";

const home = path.resolve(os.homedir());
const packageRel = path
  .relative(home, path.join(process.cwd(), "package.json"))
  .split(path.sep)
  .join("/");

describe("code-context", () => {
  it("nega caminhos bloqueados pela política", () => {
    const result = runCodeContext({ paths: [".env", "node_modules/pkg/index.js"] });
    expect(result.summaries[0]?.error).toBeTruthy();
    expect(result.summaries[1]?.error).toBeTruthy();
  });

  it("resume arquivos permitidos sob a home", () => {
    expect(packageRel.startsWith("..")).toBe(false);
    const result = runCodeContext({ paths: [packageRel] });
    expect(result.summaries[0]?.summary?.relPath).toBe(packageRel);
    expect(result.summaries[0]?.error).toBeUndefined();
  });
});
