import { describe, expect, it } from "vitest";
import {
  isLocalProvider,
  profileAllowedModels,
  rankCandidates,
  scoreCandidate,
} from "./routing-score";

describe("routing-score", () => {
  it("prioriza provider local para dados confidenciais", () => {
    const local = scoreCandidate({
      alias: "local-openai",
      provider: "local",
      available: true,
      privacyClass: "confidential",
      profileId: "conversa",
      estimatedCostUsd: 0,
      avgLatencyMs: 800,
    });
    const cloud = scoreCandidate({
      alias: "gemini",
      provider: "google",
      available: true,
      privacyClass: "confidential",
      profileId: "conversa",
      estimatedCostUsd: 0.002,
      avgLatencyMs: 900,
    });

    expect(local.total).toBeGreaterThan(cloud.total);
  });

  it("desqualifica cloud para secret", () => {
    const cloud = scoreCandidate({
      alias: "gemini",
      provider: "google",
      available: true,
      privacyClass: "secret",
      profileId: "conversa",
    });
    expect(cloud.disqualified).toBe("privacy_blocked");
  });

  it("respeita modelos permitidos do perfil", () => {
    const allowed = profileAllowedModels("monitor");
    expect(allowed).toContain("deepseek-flash");
    expect(allowed).not.toContain("codex");
  });

  it("rankeia candidatos disponíveis acima dos indisponíveis", () => {
    const ranked = rankCandidates([
      {
        alias: "local-openai",
        provider: "local",
        available: false,
        privacyClass: "internal",
      },
      {
        alias: "gemini",
        provider: "google",
        available: true,
        privacyClass: "internal",
        profileId: "conversa",
      },
    ]);

    expect(ranked[0]?.alias).toBe("gemini");
    expect(ranked[1]?.disqualified).toBe("unavailable");
  });

  it("identifica provider local", () => {
    expect(isLocalProvider("local")).toBe(true);
    expect(isLocalProvider("google")).toBe(false);
  });
});
