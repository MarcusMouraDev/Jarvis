import { afterEach, describe, expect, it } from "vitest";
import { POST as approvalsPost } from "./tools/approvals/route";
import { POST as schedulerPost } from "./scheduler/route";
import { POST as shellPost } from "./tools/shell/route";

const originalSafeCore = process.env.JARVIS_SAFE_AGENT_CORE;

afterEach(() => {
  if (originalSafeCore === undefined) delete process.env.JARVIS_SAFE_AGENT_CORE;
  else process.env.JARVIS_SAFE_AGENT_CORE = originalSafeCore;
});

describe("legacy executor safe-core guard", () => {
  it.each([
    ["shell", shellPost, "http://localhost/api/tools/shell"],
    ["approvals", approvalsPost, "http://localhost/api/tools/approvals"],
    ["scheduler", schedulerPost, "http://localhost/api/scheduler"],
  ])("returns 410 before parsing for %s", async (_name, handler, url) => {
    process.env.JARVIS_SAFE_AGENT_CORE = "1";
    const response = await handler(
      new Request(url, {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "legacy_executor_disabled" });
  });

  it("preserves the legacy shell parsing path when flag is 0", async () => {
    process.env.JARVIS_SAFE_AGENT_CORE = "0";
    const response = await shellPost(
      new Request("http://localhost/api/tools/shell", {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
  });
});
