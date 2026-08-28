import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CentralWorkspaceStore } from "./central-workspace";

const sha256 = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

describe("CentralWorkspaceStore", () => {
  let root: string;
  let store: CentralWorkspaceStore;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jarvis-workspace-"));
    store = new CentralWorkspaceStore(root);
    store.createWorkspace({ workspaceId: "main", name: "Jarvis" });
  });

  afterEach(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("resumes chunks idempotently and commits content by hash", () => {
    const first = Buffer.from("olá ");
    const second = Buffer.from("mundo\n");
    const full = Buffer.concat([first, second]);
    const upload = store.createUpload({
      workspaceId: "main",
      fileName: "nota.txt",
      relativePath: "Inbox/nota.txt",
      mime: "text/plain",
      size: full.length,
      sha256: sha256(full),
      origin: "iphone",
    });

    expect(store.putChunk(upload.uploadId, 1, second, sha256(second)).accepted).toBe(true);
    expect(store.putChunk(upload.uploadId, 0, first, sha256(first)).accepted).toBe(true);
    expect(store.putChunk(upload.uploadId, 0, first, sha256(first)).duplicate).toBe(true);

    const file = store.completeUpload(upload.uploadId);
    expect(store.completeUpload(upload.uploadId)).toEqual(file);
    expect(file).toMatchObject({
      workspaceId: "main",
      relativePath: "Inbox/nota.txt",
      version: 1,
      sha256: sha256(full),
      origin: "iphone",
    });
    expect(store.readFileContent(file.fileId).toString()).toBe("olá mundo\n");
    expect(store.listFiles("main")).toHaveLength(1);
  });

  it("recognizes common Office containers without trusting the claimed MIME", () => {
    const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    const upload = store.createUpload({
      workspaceId: "main",
      fileName: "relatorio.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: docx.length,
      sha256: sha256(docx),
      origin: "iphone",
    });

    store.putChunk(upload.uploadId, 0, docx, sha256(docx));
    expect(store.completeUpload(upload.uploadId).mime).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("rejects traversal, malicious names and false MIME claims", () => {
    expect(() =>
      store.createUpload({
        workspaceId: "main",
        fileName: "../segredo.txt",
        mime: "text/plain",
        size: 1,
        sha256: "a".repeat(64),
        origin: "telegram",
      }),
    ).toThrow("unsafe_file_name");

    const pdf = Buffer.from("%PDF-1.7\n");
    const upload = store.createUpload({
      workspaceId: "main",
      fileName: "falso.txt",
      mime: "text/plain",
      size: pdf.length,
      sha256: sha256(pdf),
      origin: "telegram",
    });
    store.putChunk(upload.uploadId, 0, pdf, sha256(pdf));
    expect(() => store.completeUpload(upload.uploadId)).toThrow("mime_mismatch");
  });

  it("rejects oversized chunks before writing quarantine data", () => {
    const upload = store.createUpload({
      workspaceId: "main",
      fileName: "small.bin",
      mime: "application/octet-stream",
      size: 2,
      sha256: sha256(Buffer.from("ok")),
      origin: "iphone",
    });
    const body = Buffer.from("too large");
    expect(() => store.putChunk(upload.uploadId, 0, body, sha256(body))).toThrow(
      "upload_size_exceeded",
    );
  });

  it("requires base version, preserves history and uses soft deletion", () => {
    const upload = store.createUpload({
      workspaceId: "main",
      fileName: "estado.txt",
      mime: "text/plain",
      size: 2,
      sha256: sha256(Buffer.from("v1")),
      origin: "vps",
    });
    store.putChunk(upload.uploadId, 0, Buffer.from("v1"), sha256(Buffer.from("v1")));
    const file = store.completeUpload(upload.uploadId);

    expect(() =>
      store.createVersionUpload(file.fileId, 0, {
        fileName: "estado.txt",
        mime: "text/plain",
        size: 2,
        sha256: sha256(Buffer.from("v2")),
        origin: "mac",
      }),
    ).toThrow("version_conflict");

    const replacement = store.createVersionUpload(file.fileId, 1, {
      fileName: "estado.txt",
      mime: "text/plain",
      size: 2,
      sha256: sha256(Buffer.from("v2")),
      origin: "mac",
    });
    store.putChunk(replacement.uploadId, 0, Buffer.from("v2"), sha256(Buffer.from("v2")));
    expect(store.completeUpload(replacement.uploadId).version).toBe(2);
    expect(store.listVersions(file.fileId).map((item) => item.version)).toEqual([2, 1]);

    store.deleteFile(file.fileId);
    expect(store.listFiles("main")).toEqual([]);
    expect(store.listFiles("main", { includeDeleted: true })[0]?.deletedAt).toBeTruthy();
  });
});
