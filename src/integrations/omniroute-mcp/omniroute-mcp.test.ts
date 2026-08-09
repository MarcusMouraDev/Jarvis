import { afterEach, describe, expect, it } from "vitest";
import { isLoopbackBaseUrl } from "./allowlist";
import { OmnirouteMcpClient } from "./client";
import { runOmnirouteMcpTool } from "./run";

const originalFlag = process.env.JARVIS_OMNIROUTE_MCP;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.JARVIS_OMNIROUTE_MCP;
  else process.env.JARVIS_OMNIROUTE_MCP = originalFlag;
});

describe("omniroute-mcp", () => {
  it("accepts only loopback base URLs", () => {
    expect(isLoopbackBaseUrl("http://127.0.0.1:20128")).toBe(true);
    expect(isLoopbackBaseUrl("http://localhost:20128")).toBe(true);
    expect(isLoopbackBaseUrl("https://evil.example")).toBe(false);
  });

  it("denies tools when the feature flag is off", async () => {
    delete process.env.JARVIS_OMNIROUTE_MCP;
    const result = await runOmnirouteMcpTool("omniroute.list_models", {});
    expect(result).toEqual({
      status: "denied",
      reason: "omniroute_mcp_disabled",
    });
  });

  it("denies tools outside the read allowlist", async () => {
    process.env.JARVIS_OMNIROUTE_MCP = "1";
    const result = await runOmnirouteMcpTool("omniroute.route_request", {});
    expect(result).toEqual({
      status: "denied",
      reason: "tool_not_allowlisted",
    });
  });

  it("lists models through a mocked loopback client", async () => {
    process.env.JARVIS_OMNIROUTE_MCP = "1";
    const client = new OmnirouteMcpClient({
      baseUrl: "http://127.0.0.1:20128",
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "model-a", owned_by: "omni" }],
          }),
          { status: 200 },
        )) as typeof fetch,
    });

    const result = await runOmnirouteMcpTool("omniroute.list_models", {}, { client });
    expect(result).toEqual({
      status: "ok",
      output: {
        models: [{ id: "model-a", ownedBy: "omni" }],
        source: "omniroute:/v1/models",
      },
    });
  });

  it("maps timeout to a failed result", async () => {
    process.env.JARVIS_OMNIROUTE_MCP = "1";
    const client = new OmnirouteMcpClient({
      baseUrl: "http://127.0.0.1:20128",
      timeoutMs: 5,
      fetchImpl: (async (_input, init) => {
        await new Promise<void>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });

    const result = await runOmnirouteMcpTool(
      "omniroute.check_quota",
      {},
      { client },
    );
    expect(result).toEqual({ status: "failed", reason: "omniroute_timeout" });
  });

  it("denies non-loopback hosts", async () => {
    process.env.JARVIS_OMNIROUTE_MCP = "1";
    const client = new OmnirouteMcpClient({
      baseUrl: "https://example.com",
      fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch,
    });
    const result = await runOmnirouteMcpTool(
      "omniroute.compression_status",
      {},
      { client },
    );
    expect(result).toEqual({
      status: "denied",
      reason: "omniroute_host_not_loopback",
    });
  });
});
