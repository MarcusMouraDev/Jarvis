import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { getJarvisDataDir } from "./data-dir";

const originalDataDir = process.env.JARVIS_DATA_DIR;

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
  else process.env.JARVIS_DATA_DIR = originalDataDir;
});

describe("getJarvisDataDir", () => {
  it("usa o diretório padrão quando JARVIS_DATA_DIR está vazio", () => {
    process.env.JARVIS_DATA_DIR = "";

    expect(getJarvisDataDir()).toBe(path.join(process.cwd(), ".jarvis"));
  });
});
