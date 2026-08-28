import { describe, expect, it } from "vitest";
import { assertNever } from "./assert-never";

describe("assertNever", () => {
  it("fails loudly when an unexpected variant reaches a closed switch", () => {
    expect(() => assertNever("unexpected" as never)).toThrow("unexpected_variant:unexpected");
  });
});
