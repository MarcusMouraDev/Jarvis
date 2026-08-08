import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPathDenied, resolveRepoPath } from "./path-policy";

const root = path.join(process.cwd());

describe("path-policy", () => {
  it("bloqueia .env e escapes", () => {
    expect(isPathDenied(".env", root).denied).toBe(true);
    expect(isPathDenied("node_modules/x", root).denied).toBe(true);
    expect(isPathDenied("../outside", root).denied).toBe(true);
  });

  it("permite arquivos do repo", () => {
    expect(isPathDenied("package.json", root).denied).toBe(false);
    expect(resolveRepoPath("package.json", root)).toBe(
      path.resolve(root, "package.json"),
    );
  });
});
