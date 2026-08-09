import { afterEach, describe, expect, it } from "vitest";
import {
  buildRoutingCandidates,
  createCloudEgressDigest,
  isSmartRoutingEnabled,
  selectSafeModelAlias,
  selectModelAlias,
  wouldRouteConfidentialToCloud,
} from "./model-gateway";
import { loadAgentCatalogFromYaml } from "./agent-catalog";

const originalSmartRouting = process.env.JARVIS_SMART_ROUTING;

afterEach(() => {
  if (originalSmartRouting === undefined) {
    delete process.env.JARVIS_SMART_ROUTING;
  } else {
    process.env.JARVIS_SMART_ROUTING = originalSmartRouting;
  }
});

describe("model-gateway", () => {
  const safeCatalog = loadAgentCatalogFromYaml(`
version: 1
default_model: local
models:
  local: { provider: local, costs_extra: false, fallback: [gemini] }
  gemini: { provider: google, costs_extra: true, fallback: [] }
agents:
  Hermes:
    workspace_mode: optional_existing
    mutation_mode: controlled
    tools: [code.context]
    memory_policy: manual
    budget_usd: 0
    timeout_ms: 1000
  Planner:
    workspace_mode: optional_existing
    mutation_mode: none
    tools: [code.context]
    memory_policy: off
    budget_usd: 0
    timeout_ms: 1000
  Developer:
    workspace_mode: existing_repo
    mutation_mode: controlled
    tools: [code.context]
    memory_policy: manual
    budget_usd: 0
    timeout_ms: 1000
  Builder:
    workspace_mode: new_project
    mutation_mode: controlled
    tools: [code.context]
    memory_policy: consent
    budget_usd: 0
    timeout_ms: 1000
`);

  it("defaults the safe core to local without cloud fallback", () => {
    expect(
      selectSafeModelAlias({
        catalog: safeCatalog,
        privacyClass: "internal",
        availableAliases: ["local", "gemini"],
      }),
    ).toMatchObject({ alias: "local", provider: "local", costsExtra: false });
  });

  it("blocks paid providers until explicitly enabled", () => {
    expect(() =>
      selectSafeModelAlias({
        catalog: safeCatalog,
        requestedAlias: "gemini",
        privacyClass: "internal",
        availableAliases: ["gemini"],
      }),
    ).toThrow("paid_provider_disabled");
  });

  it("requires exact cloud egress approval for sensitive content", () => {
    expect(() =>
      selectSafeModelAlias({
        catalog: safeCatalog,
        requestedAlias: "gemini",
        privacyClass: "confidential",
        availableAliases: ["gemini"],
        allowPaidProvider: true,
        content: "private prompt",
        context: { files: ["a.ts"] },
        modelIds: { gemini: "gemini-safe" },
      }),
    ).toThrow("cloud_egress_approval_required");
  });

  it("accepts sensitive cloud egress only for the exact content, context, provider and model", () => {
    const approval = createCloudEgressDigest({
      content: "private prompt",
      context: { files: ["a.ts"] },
      provider: "google",
      model: "gemini-safe",
    });
    expect(
      selectSafeModelAlias({
        catalog: safeCatalog,
        requestedAlias: "gemini",
        privacyClass: "secret",
        availableAliases: ["gemini"],
        allowPaidProvider: true,
        content: "private prompt",
        context: { files: ["a.ts"] },
        modelIds: { gemini: "gemini-safe" },
        approvedCloudEgressDigest: approval,
      }),
    ).toMatchObject({
      alias: "gemini",
      provider: "google",
      model: "gemini-safe",
      cloudEgressDigest: approval,
    });

    expect(() =>
      selectSafeModelAlias({
        catalog: safeCatalog,
        requestedAlias: "gemini",
        privacyClass: "secret",
        availableAliases: ["gemini"],
        allowPaidProvider: true,
        content: "private prompt",
        context: { files: ["changed.ts"] },
        modelIds: { gemini: "gemini-safe" },
        approvedCloudEgressDigest: approval,
      }),
    ).toThrow("cloud_egress_approval_required");

    expect(() =>
      selectSafeModelAlias({
        catalog: safeCatalog,
        requestedAlias: "gemini",
        privacyClass: "secret",
        availableAliases: ["gemini"],
        allowPaidProvider: true,
        content: "private prompt",
        context: { files: ["a.ts"] },
        modelIds: { gemini: "different-model" },
        approvedCloudEgressDigest: approval,
      }),
    ).toThrow("cloud_egress_approval_required");
  });

  it("never falls back from a missing local model to cloud", () => {
    expect(() =>
      selectSafeModelAlias({
        catalog: safeCatalog,
        privacyClass: "internal",
        availableAliases: ["gemini"],
        allowPaidProvider: true,
      }),
    ).toThrow("local_model_unavailable");
  });

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
