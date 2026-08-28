import { describe, expect, it } from "vitest";
import { attachmentsFromChips } from "./attachments";

describe("attachmentsFromChips", () => {
  it("maps path chips to file or image and keeps paste bytes", () => {
    expect(
      attachmentsFromChips([
        {
          id: "1",
          kind: "path",
          relPath: "note.md",
          label: "note.md",
          summary: {
            relPath: "note.md",
            absPath: "/tmp/note.md",
            hash: "a",
            byteSize: 1,
            lineCount: 1,
            language: "md",
            exports: [],
            imports: [],
            symbols: [],
            excerpt: "",
          },
        },
        {
          id: "2",
          kind: "path",
          relPath: "shot.png",
          label: "shot.png",
          summary: {
            relPath: "shot.png",
            absPath: "/tmp/shot.png",
            hash: "b",
            byteSize: 1,
            lineCount: 1,
            language: "png",
            exports: [],
            imports: [],
            symbols: [],
            excerpt: "",
          },
        },
        {
          id: "3",
          kind: "image",
          label: "paste.png",
          contentBase64: "aGVsbG8=",
          filename: "paste.png",
        },
      ]),
    ).toEqual([
      { kind: "file", path: "/tmp/note.md" },
      { kind: "image", path: "/tmp/shot.png" },
      { kind: "image-bytes", contentBase64: "aGVsbG8=", filename: "paste.png" },
    ]);
  });
});
