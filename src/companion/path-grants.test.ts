import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveGrantedFile } from "./path-grants";

describe("resolveGrantedFile", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jarvis-grant-"));
    outside = mkdtempSync(path.join(tmpdir(), "jarvis-outside-"));
    mkdirSync(path.join(root, "sub"));
    writeFileSync(path.join(root, "sub", "ok.txt"), "ok");
    writeFileSync(path.join(outside, "secret.txt"), "secret");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("allows a regular file inside the granted root", () => {
    expect(resolveGrantedFile(root, "sub/ok.txt")).toBe(
      realpathSync(path.join(root, "sub", "ok.txt")),
    );
  });

  it("rejects traversal and symlink escapes", () => {
    expect(() => resolveGrantedFile(root, "../secret.txt")).toThrow("grant_path_escape");
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    expect(() => resolveGrantedFile(root, "link.txt")).toThrow("grant_symlink_rejected");
  });
});
