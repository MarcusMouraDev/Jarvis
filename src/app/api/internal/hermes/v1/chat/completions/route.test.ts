import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("Hermes model broker", () => {
  beforeEach(() => {
    vi.stubEnv("JARVIS_BROKER_ENABLED", "1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("is unavailable on the public web process", async () => {
    vi.stubEnv("JARVIS_BROKER_ENABLED", "0");
    vi.stubEnv("HERMES_BROKER_TOKEN", "broker-secret");
    const response = await POST(new Request("http://localhost/api/internal/hermes/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer broker-secret" },
      body: JSON.stringify({ messages: [] }),
    }));

    expect(response.status).toBe(404);
  });

  it("rejects requests without the private broker token", async () => {
    vi.stubEnv("HERMES_BROKER_TOKEN", "broker-secret");
    const response = await POST(new Request("http://jarvis/api/internal/hermes/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [] }),
    }));
    expect(response.status).toBe(401);
  });

  it("forces Jarvis policy and model alias before forwarding", async () => {
    vi.stubEnv("HERMES_BROKER_TOKEN", "broker-secret");
    vi.stubEnv("LOCAL_OPENAI_BASE_URL", "http://omniroute:20128");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await POST(new Request("http://jarvis/api/internal/hermes/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer broker-secret" },
      body: JSON.stringify({ model: "auto/best-chat", messages: [{ role: "user", content: "oi" }] }),
    }));
    const forwarded = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(forwarded.model).toBe("local");
    expect(forwarded.messages[0].role).toBe("system");
    expect(forwarded.messages[0].content).toContain("Você é Jarvis");
    expect(forwarded.metadata.jarvis_soul_policy_version).toBe("1.0.0");
    expect(forwarded.metadata.jarvis_soul_digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("propagates one correlation id through OmniRoute and the response", async () => {
    vi.stubEnv("HERMES_BROKER_TOKEN", "broker-secret");
    vi.stubEnv("LOCAL_OPENAI_BASE_URL", "http://omniroute:20128");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const response = await POST(new Request("http://jarvis-worker:3001/api/internal/hermes/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer broker-secret",
        "x-request-id": "run_01:model_02",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "oi" }] }),
    }));

    const forwarded = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-request-id")).toBe("run_01:model_02");
    expect(forwarded.metadata.jarvis_correlation_id).toBe("run_01:model_02");
    expect(response.headers.get("x-request-id")).toBe("run_01:model_02");
  });
});
