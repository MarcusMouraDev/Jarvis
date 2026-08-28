import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "./normalize-base-url";

describe("normalizeBaseUrl", () => {
  it.each([
    ["http://127.0.0.1:20128/", "http://127.0.0.1:20128"],
    ["https://gateway.example/v1///", "https://gateway.example/v1"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["", ""],
  ])("normalizes %j", (value, expected) => {
    expect(normalizeBaseUrl(value)).toBe(expected);
  });
});
