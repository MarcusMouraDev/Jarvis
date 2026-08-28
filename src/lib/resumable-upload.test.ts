import { describe, expect, it } from "vitest";
import { browserUploadOrigin, splitUploadChunks } from "./resumable-upload";

describe("splitUploadChunks", () => {
  it("creates stable indexed chunks without copying outside bounds", () => {
    expect(splitUploadChunks(10, 4)).toEqual([
      { index: 0, start: 0, end: 4 },
      { index: 1, start: 4, end: 8 },
      { index: 2, start: 8, end: 10 },
    ]);
  });

  it("rejects invalid sizes", () => {
    expect(() => splitUploadChunks(-1, 4)).toThrow("invalid_upload_size");
    expect(() => splitUploadChunks(4, 0)).toThrow("invalid_chunk_size");
  });
});

describe("browserUploadOrigin", () => {
  it("distinguishes iOS Files uploads from Mac browser uploads", () => {
    expect(browserUploadOrigin("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(
      "iphone",
    );
    expect(browserUploadOrigin("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
  });
});
