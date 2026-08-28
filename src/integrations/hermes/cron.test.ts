import { describe, expect, it } from "vitest";
import { jobsFromCronResult } from "./cron";

describe("jobsFromCronResult", () => {
  it("reads jobs from a cron.manage list payload", () => {
    expect(
      jobsFromCronResult({
        success: true,
        jobs: [{ id: "j1", name: "daily", schedule: "0 8 * * *" }],
      }),
    ).toEqual([{ id: "j1", name: "daily", schedule: "0 8 * * *" }]);
    expect(jobsFromCronResult(null)).toEqual([]);
  });
});
