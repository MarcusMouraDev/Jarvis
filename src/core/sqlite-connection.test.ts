import { describe, expect, it } from "vitest";
import { configureSqliteConnection } from "./sqlite-connection";

describe("configureSqliteConnection", () => {
  it("uses WAL and a bounded lock wait for every store", () => {
    const pragmas: string[] = [];
    configureSqliteConnection({ pragma: (value: string) => pragmas.push(value) });

    expect(pragmas).toEqual(["journal_mode = WAL", "busy_timeout = 5000"]);
  });

  it("enables foreign keys only when the store requests it", () => {
    const pragmas: string[] = [];
    configureSqliteConnection(
      { pragma: (value: string) => pragmas.push(value) },
      { foreignKeys: true },
    );

    expect(pragmas).toContain("foreign_keys = ON");
  });
});
