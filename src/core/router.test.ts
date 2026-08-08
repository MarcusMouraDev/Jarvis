import { describe, expect, it } from "vitest";
import { collectStream, codexHasNoFallback, evaluateCloudFallbackConsent, routeTextRequest } from "./router";

describe("router", () => {
  it("codex não tem fallback", () => {
    expect(codexHasNoFallback()).toBe(true);
  });

  it("força fallback visível gemini → deepseek-flash", async () => {
    const { route } = await routeTextRequest("gemini", "oi", {
      forceFallback: true,
    });
    expect(route.fallbackUsed).toBe(true);
    expect(route.effectiveAlias).toBe("deepseek-flash");
    expect(route.requestedAlias).toBe("gemini");
    expect(route.fallbackReason).toBeTruthy();
  });

  it("rate_limit dispara fallback limitado", async () => {
    const { request, route } = await routeTextRequest("gemini", "oi", {
      failure: "rate_limit",
    });
    expect(route.fallbackUsed).toBe(true);
    const { response } = await collectStream(route.adapter!.stream(request));
    expect(response.fallbackUsed).toBe(true);
    expect(response.model).toBe("deepseek-flash");
  });

  it("codex com falha não mascara (sem fallback)", async () => {
    const { route } = await routeTextRequest("codex", "oi", {
      failure: "unavailable",
    });
    expect(route.fallbackUsed).toBe(false);
    expect(route.effectiveAlias).toBe("codex");
  });

  it("exige consentimento para fallback confidencial local→nuvem", async () => {
    const consent = evaluateCloudFallbackConsent({
      requestedAlias: "local-openai",
      effectiveAlias: "gemini",
      privacyClass: "confidential",
      fallbackUsed: true,
    });
    expect(consent?.required).toBe(true);

    const { route } = await routeTextRequest("local-openai", "segredo", {
      privacyClass: "confidential",
      forceFallback: true,
    });
    expect(route.cloudFallbackConsentRequired).toBe(true);
    expect(route.adapter).toBeUndefined();
  });
});
