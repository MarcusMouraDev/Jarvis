import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getContextRoot,
  isPathDenied,
  resolveRepoPath,
  toContextRelPath,
} from "./path-policy";

const repoRoot = path.join(process.cwd());
const home = path.resolve(os.homedir());

describe("path-policy", () => {
  it("bloqueia .env e escapes", () => {
    expect(isPathDenied(".env", repoRoot).denied).toBe(true);
    expect(isPathDenied("node_modules/x", repoRoot).denied).toBe(true);
    expect(isPathDenied("../outside", repoRoot).denied).toBe(true);
  });

  it("permite arquivos do repo quando root é o repo", () => {
    expect(isPathDenied("package.json", repoRoot).denied).toBe(false);
    expect(resolveRepoPath("package.json", repoRoot)).toBe(
      path.resolve(repoRoot, "package.json"),
    );
  });

  it("usa a home como JARVIS_CONTEXT_ROOT padrão", () => {
    expect(getContextRoot()).toBe(home);
  });

  it("bloqueia áreas sensíveis sob a home", () => {
    expect(isPathDenied(".ssh/id_rsa", home).denied).toBe(true);
    expect(isPathDenied("Library/Keychains/login.keychain-db", home).denied).toBe(
      true,
    );
  });

  it("permite pastas típicas do Mac sob a home", () => {
    expect(isPathDenied("Documents", home).denied).toBe(false);
    expect(isPathDenied("Downloads", home).denied).toBe(false);
    expect(isPathDenied("Projetos/jarvis/package.json", home).denied).toBe(false);
  });

  it("toContextRelPath normaliza com barras /", () => {
    const abs = path.join(home, "Documents", "nota.md");
    expect(toContextRelPath(abs, home)).toBe("Documents/nota.md");
  });
});
