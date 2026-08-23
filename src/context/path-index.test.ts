import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { indexPaths } from "./path-index";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-path-index-"));

fs.mkdirSync(path.join(tmpRoot, "Documents", "notes"), { recursive: true });
fs.mkdirSync(path.join(tmpRoot, "Projetos", "demo", "src"), { recursive: true });
fs.writeFileSync(path.join(tmpRoot, "Documents", "notes", "idea.md"), "# hi\n");
fs.writeFileSync(path.join(tmpRoot, "Projetos", "demo", "src", "app.ts"), "export {}\n");
fs.writeFileSync(path.join(tmpRoot, "Projetos", "demo", "README.md"), "demo\n");

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("path-index", () => {
  it("encontra arquivos em qualquer pasta sob o context root", () => {
    const hits = indexPaths("idea", tmpRoot, 20);
    expect(hits.some((h) => h.relPath.endsWith("Documents/notes/idea.md"))).toBe(
      true,
    );
  });

  it("navega por prefixo de pasta", () => {
    const hits = indexPaths("Projetos/demo", tmpRoot, 20);
    expect(hits.some((h) => h.relPath.includes("Projetos/demo"))).toBe(true);
  });

  it("não vaza node_modules", () => {
    fs.mkdirSync(path.join(tmpRoot, "Projetos", "demo", "node_modules", "x"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpRoot, "Projetos", "demo", "node_modules", "x", "index.js"),
      "1",
    );
    const hits = indexPaths("index", tmpRoot, 40);
    expect(hits.every((h) => !h.relPath.includes("node_modules"))).toBe(true);
  });
});
