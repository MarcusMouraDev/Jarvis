import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadProfilesFromYaml, listProfiles } from "./profiles";

describe("profiles", () => {
  it("carrega config/profiles.yaml", () => {
    const raw = readFileSync(
      resolve(__dirname, "../../config/profiles.yaml"),
      "utf8",
    );
    const profiles = loadProfilesFromYaml(raw);
    expect(profiles.conversa.allowedModels).toContain("gemini");
    expect(profiles.briefing.memoryPolicy).toBe("off");
    expect(profiles.monitor.timeoutMs).toBe(60_000);
  });

  it("lista perfis do disco", () => {
    const ids = listProfiles().map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(["conversa", "pesquisa", "briefing", "monitor"]),
    );
  });
});
