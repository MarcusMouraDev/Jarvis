import { afterEach, describe, expect, it } from "vitest";
import {
  buildRoutingCandidates,
  isSmartRoutingEnabled,
  selectModelAlias,
  wouldRouteConfidentialToCloud,
} from "./model-gateway";

const originalSmartRouting = process.env.JARVIS_SMART_ROUTING;

afterEach(() => {
  if (originalSmartRouting === undefined) {
    delete process.env.JARVIS_SMART_ROUTING;
  } else {
    process.env.JARVIS_SMART_ROUTING = originalSmartRouting;
  }
});

describe("model-gateway", () => {
  it("mantém alias solicitado com smart routing desligado", () => {
    delete process.env.JARVIS_SMART_ROUTING;
    const selection = selectModelAlias({
      requestedAlias: "gemini",
      privacyClass: "internal",
      profileId: "conversa",
    });
    expect(selection.alias).toBe("gemini");
    expect(selection.smartRouting).toBe(false);
    expect(isSmartRoutingEnabled()).toBe(false);
  });

  it("pode escolher outro alias com smart routing ligado", () => {
    process.env.JARVIS_SMART_ROUTING = "1";
    const selection = selectModelAlias({
      requestedAlias: "codex",
      privacyClass: "confidential",
      profileId: "conversa",
    });
    expect(selection.smartRouting).toBe(true);
    expect(selection.scores.length).toBeGreaterThan(0);
    expect(selection.alias).not.toBe("");
  });

  it("detecta fallback confidencial local→nuvem", () => {
    expect(
      wouldRouteConfidentialToCloud({
        requestedAlias: "local-openai",
        effectiveAlias: "gemini",
        privacyClass: "confidential",
      }),
    ).toBe(true);
    expect(
      wouldRouteConfidentialToCloud({
        requestedAlias: "local-openai",
        effectiveAlias: "gemini",
        privacyClass: "internal",
      }),
    ).toBe(false);
  });

  it("monta candidatos para todos os aliases", () => {
    const candidates = buildRoutingCandidates({
      privacyClass: "internal",
      profileId: "conversa",
    });
    expect(candidates.some((c) => c.alias === "local-openai")).toBe(true);
    expect(candidates.some((c) => c.alias === "gemini")).toBe(true);
  });
});
