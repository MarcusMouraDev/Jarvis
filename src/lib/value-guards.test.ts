import { describe, expect, it } from "vitest";
import { asNonEmptyString, asRecord } from "./value-guards";

describe("value guards", () => {
  it("accepts only plain records", () => {
    expect(asRecord({ key: "value" })).toEqual({ key: "value" });
    expect(asRecord(null)).toBeNull();
    expect(asRecord(["value"])).toBeNull();
    expect(asRecord("value")).toBeNull();
  });

  it("accepts only non-empty strings", () => {
    expect(asNonEmptyString("value")).toBe("value");
    expect(asNonEmptyString("")).toBeNull();
    expect(asNonEmptyString(1)).toBeNull();
  });
});
