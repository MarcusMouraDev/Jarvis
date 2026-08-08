import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDomainAllowed } from "./allowlist";
import { runBrowser } from "./run";

const originalFlag = process.env.JARVIS_BROWSER;
const originalMock = process.env.JARVIS_BROWSER_MOCK;

describe("browser", () => {
  beforeEach(() => {
    delete process.env.JARVIS_BROWSER;
    process.env.JARVIS_BROWSER_MOCK = "1";
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.JARVIS_BROWSER;
    else process.env.JARVIS_BROWSER = originalFlag;
    if (originalMock === undefined) delete process.env.JARVIS_BROWSER_MOCK;
    else process.env.JARVIS_BROWSER_MOCK = originalMock;
  });

  it("nega execução quando flag desligada", async () => {
    const result = await runBrowser({
      url: "https://example.com",
      steps: [{ action: "extract" }],
    });
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.reason).toBe("browser_disabled");
    }
  });

  it("nega domínio fora da allowlist", async () => {
    process.env.JARVIS_BROWSER = "1";
    const result = await runBrowser({
      url: "https://evil.example.org",
      steps: [{ action: "extract" }],
      planAcknowledged: true,
    });
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.reason).toBe("domain_not_allowlisted");
    }
  });

  it("permite domínio allowlisted em mock mode", async () => {
    process.env.JARVIS_BROWSER = "1";
    const result = await runBrowser({
      url: "https://example.com",
      steps: [{ action: "extract" }],
      planAcknowledged: true,
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.output.mock).toBe(true);
      expect(result.output.plan.length).toBeGreaterThan(0);
    }
  });

  it("isDomainAllowed reconhece subdomínio", () => {
    expect(isDomainAllowed("https://www.example.com/page")).toBe(true);
    expect(isDomainAllowed("https://blocked.test")).toBe(false);
  });
});
