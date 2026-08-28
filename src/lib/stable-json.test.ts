import { describe, expect, it } from "vitest";
import { stableJson } from "./stable-json";

describe("stableJson", () => {
  it("orders object keys recursively without changing array order", () => {
    expect(stableJson({ z: ["second", "first"], a: { d: 2, b: 1 } })).toBe(
      '{"a":{"b":1,"d":2},"z":["second","first"]}',
    );
  });
});
