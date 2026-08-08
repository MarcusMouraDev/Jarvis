import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jarvisConfig, loadConfigFromYaml } from "./config";

describe("config/models.yaml", () => {
  it("carrega e espelha jarvisConfig", () => {
    const raw = readFileSync(
      resolve(__dirname, "../../config/models.yaml"),
      "utf8",
    );
    const fromYaml = loadConfigFromYaml(raw);
    expect(fromYaml.version).toBe(jarvisConfig.version);
    expect(fromYaml.defaultModel).toBe(jarvisConfig.defaultModel);
    expect(Object.keys(fromYaml.models)).toEqual(
      Object.keys(jarvisConfig.models),
    );
    expect(fromYaml.models.codex.fallback).toEqual([]);
    expect(fromYaml.voice.locale).toBe("pt-BR");
  });
});
