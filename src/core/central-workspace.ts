import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { configureSqliteConnection } from "./sqlite-connection";

export type FileOrigin = "mac" | "iphone" | "telegram" | "vps";

export interface WorkspaceFile {
  fileId: string;
  workspaceId: string;
  relativePath: string;
  mime: string;
  size: number;
  sha256: string;
  version: number;
  origin: FileOrigin;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface WorkspaceFileVersion {
  fileId: string;
  version: number;
  mime: string;
  size: number;
  sha256: string;
  origin: FileOrigin;
  createdAt: string;
}

export interface CreateUploadInput {
  workspaceId: string;
  fileName: string;
  relativePath?: string;
  mime: string;
  size: number;
  sha256: string;
  origin: FileOrigin;
}

interface UploadRow extends CreateUploadInput {
  uploadId: string;
  fileId: string | null;
  baseVersion: number | null;
  expiresAt: string;
  status: "open" | "complete";
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_CHUNK_BYTES = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

function now(): string {
  return new Date().toISOString();
}

function assertId(value: string, code: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(normalized)) throw new Error(code);
  return normalized;
}

function assertFileName(value: string): string {
  const normalized = value.normalize("NFC").trim();
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    Buffer.byteLength(normalized) > 255
  ) {
    throw new Error("unsafe_file_name");
  }
  return normalized;
}

function assertRelativePath(value: string, fileName: string): string {
  const normalized = value.normalize("NFC").replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.includes("\0")) {
    throw new Error("unsafe_relative_path");
  }
  const segments = normalized.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    segments.at(-1) !== fileName
  ) {
    throw new Error("unsafe_relative_path");
  }
  return segments.join("/");
}

function assertMime(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalized)) throw new Error("invalid_mime");
  return normalized;
}

function detectMime(content: Buffer, fileName: string): string {
  if (content.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return "image/jpeg";
  if (content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const extension = path.extname(fileName).toLowerCase();
    if (extension === ".docx") {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    if (extension === ".xlsx") {
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
    if (extension === ".pptx") {
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    }
    return "application/zip";
  }
  if (!content.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(content);
      const text = content.toString("utf8").trim();
      if (text && (text.startsWith("{") || text.startsWith("["))) {
        try {
          JSON.parse(text);
          return "application/json";
        } catch {
          // Valid UTF-8, but not valid JSON.
        }
      }
      return "text/plain";
    } catch {
      // Binary fallback.
    }
  }
  return "application/octet-stream";
}

function mapFile(row: unknown): WorkspaceFile {
  const value = row as Record<string, string | number | null>;
  return {
    fileId: String(value.file_id),
    workspaceId: String(value.workspace_id),
    relativePath: String(value.relative_path),
    mime: String(value.mime),
    size: Number(value.size),
    sha256: String(value.sha256),
    version: Number(value.version),
    origin: value.origin as FileOrigin,
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
    deletedAt: value.deleted_at ? String(value.deleted_at) : null,
  };
}

function mapVersion(row: unknown): WorkspaceFileVersion {
  const value = row as Record<string, string | number>;
  return {
    fileId: String(value.file_id),
    version: Number(value.version),
    mime: String(value.mime),
    size: Number(value.size),
    sha256: String(value.sha256),
    origin: value.origin as FileOrigin,
    createdAt: String(value.created_at),
  };
}

export class CentralWorkspaceStore {
  private readonly database: Database.Database;
  private readonly contentRoot: string;
  private readonly uploadRoot: string;

  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
    this.contentRoot = path.join(root, "content");
    this.uploadRoot = path.join(root, "quarantine");
    mkdirSync(this.contentRoot, { recursive: true });
    mkdirSync(this.uploadRoot, { recursive: true });
    this.database = new Database(path.join(root, "workspace.sqlite"));
    configureSqliteConnection(this.database, { foreignKeys: true });
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        file_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
        relative_path TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        version INTEGER NOT NULL,
        origin TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE(workspace_id, relative_path)
      );
      CREATE TABLE IF NOT EXISTS file_versions (
        file_id TEXT NOT NULL REFERENCES files(file_id),
        version INTEGER NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        origin TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(file_id, version)
      );
      CREATE TABLE IF NOT EXISTS uploads (
        upload_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
        file_id TEXT REFERENCES files(file_id),
        base_version INTEGER,
        file_name TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        origin TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS upload_chunks (
        upload_id TEXT NOT NULL REFERENCES uploads(upload_id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        PRIMARY KEY(upload_id, chunk_index)
      );
      CREATE INDEX IF NOT EXISTS files_by_workspace ON files(workspace_id, deleted_at, relative_path);
    `);
  }

  close(): void {
    this.database.close();
  }

  createWorkspace(input: { workspaceId: string; name: string }): void {
    const workspaceId = assertId(input.workspaceId, "invalid_workspace_id");
    const name = input.name.trim();
    if (!name || name.length > 128) throw new Error("invalid_workspace_name");
    this.database
      .prepare("INSERT OR IGNORE INTO workspaces(workspace_id, name, created_at) VALUES (?, ?, ?)")
      .run(workspaceId, name, now());
  }

  createUpload(input: CreateUploadInput): { uploadId: string; expiresAt: string } {
    return this.insertUpload(input, null, null);
  }

  createVersionUpload(
    fileId: string,
    baseVersion: number,
    input: Omit<CreateUploadInput, "workspaceId">,
  ): { uploadId: string; expiresAt: string } {
    const current = this.getFile(fileId);
    if (!current || current.deletedAt) throw new Error("file_not_found");
    if (current.version !== baseVersion) throw new Error("version_conflict");
    return this.insertUpload(
      {
        ...input,
        workspaceId: current.workspaceId,
        relativePath: current.relativePath,
      },
      current.fileId,
      baseVersion,
    );
  }

  private insertUpload(
    input: CreateUploadInput,
    fileId: string | null,
    baseVersion: number | null,
  ): { uploadId: string; expiresAt: string } {
    const workspaceId = assertId(input.workspaceId, "invalid_workspace_id");
    if (!this.database.prepare("SELECT 1 FROM workspaces WHERE workspace_id = ?").get(workspaceId)) {
      throw new Error("workspace_not_found");
    }
    const fileName = assertFileName(input.fileName);
    const relativePath = assertRelativePath(input.relativePath ?? fileName, fileName);
    const size = Number(input.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_UPLOAD_BYTES) {
      throw new Error("invalid_upload_size");
    }
    const digest = input.sha256.toLowerCase();
    if (!SHA256.test(digest)) throw new Error("invalid_sha256");
    const uploadId = randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    this.database.prepare(`
      INSERT INTO uploads(
        upload_id, workspace_id, file_id, base_version, file_name, relative_path,
        mime, size, sha256, origin, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(
      uploadId,
      workspaceId,
      fileId,
      baseVersion,
      fileName,
      relativePath,
      assertMime(input.mime),
      size,
      digest,
      input.origin,
      now(),
      expiresAt,
    );
    mkdirSync(path.join(this.uploadRoot, uploadId), { recursive: true });
    return { uploadId, expiresAt };
  }

  putChunk(
    uploadId: string,
    chunkIndex: number,
    content: Uint8Array,
    expectedSha256: string,
  ): { accepted: true; duplicate: boolean } {
    const upload = this.getUpload(uploadId);
    if (!upload || upload.status !== "open") throw new Error("upload_not_open");
    if (upload.expiresAt <= now()) throw new Error("upload_expired");
    if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 1_000_000) {
      throw new Error("invalid_chunk_index");
    }
    const body = Buffer.from(content);
    if (body.length > MAX_UPLOAD_CHUNK_BYTES) throw new Error("chunk_too_large");
    const digest = createHash("sha256").update(body).digest("hex");
    if (digest !== expectedSha256.toLowerCase()) throw new Error("chunk_checksum_mismatch");
    const existing = this.database
      .prepare("SELECT sha256, size FROM upload_chunks WHERE upload_id = ? AND chunk_index = ?")
      .get(uploadId, chunkIndex) as { sha256: string; size: number } | undefined;
    if (existing) {
      if (existing.sha256 !== digest || existing.size !== body.length) {
        throw new Error("chunk_conflict");
      }
      return { accepted: true, duplicate: true };
    }
    const accumulated = this.database
      .prepare("SELECT COALESCE(SUM(size), 0) AS size FROM upload_chunks WHERE upload_id = ?")
      .get(uploadId) as { size: number };
    if (accumulated.size + body.length > upload.size) throw new Error("upload_size_exceeded");
    writeFileSync(path.join(this.uploadRoot, uploadId, String(chunkIndex)), body, { flag: "wx" });
    this.database
      .prepare("INSERT INTO upload_chunks(upload_id, chunk_index, sha256, size) VALUES (?, ?, ?, ?)")
      .run(uploadId, chunkIndex, digest, body.length);
    return { accepted: true, duplicate: false };
  }

  completeUpload(uploadId: string): WorkspaceFile {
    const upload = this.getUpload(uploadId);
    if (!upload) throw new Error("upload_not_open");
    if (upload.status === "complete" && upload.fileId) {
      const completed = this.getFile(upload.fileId);
      if (completed) return completed;
    }
    if (upload.status !== "open") throw new Error("upload_not_open");
    const chunks = this.database
      .prepare("SELECT chunk_index FROM upload_chunks WHERE upload_id = ? ORDER BY chunk_index")
      .all(uploadId) as Array<{ chunk_index: number }>;
    if (!chunks.length || chunks.some((item, index) => item.chunk_index !== index)) {
      throw new Error("upload_incomplete");
    }
    const content = Buffer.concat(
      chunks.map((item) => readFileSync(path.join(this.uploadRoot, uploadId, String(item.chunk_index)))),
    );
    if (content.length !== upload.size) throw new Error("upload_size_mismatch");
    const digest = createHash("sha256").update(content).digest("hex");
    if (digest !== upload.sha256) throw new Error("upload_checksum_mismatch");
    const detectedMime = detectMime(content, upload.fileName);
    if (upload.mime !== detectedMime && upload.mime !== "application/octet-stream") {
      throw new Error("mime_mismatch");
    }

    const contentDirectory = path.join(this.contentRoot, digest.slice(0, 2));
    const contentPath = path.join(contentDirectory, digest);
    mkdirSync(contentDirectory, { recursive: true });
    const stagedPath = path.join(this.uploadRoot, uploadId, "complete");
    writeFileSync(stagedPath, content, { flag: "wx" });
    if (!existsSync(contentPath)) renameSync(stagedPath, contentPath);
    else rmSync(stagedPath);

    const timestamp = now();
    const file = this.database.transaction(() => {
      let completed: WorkspaceFile;
      if (upload.fileId) {
        const current = this.getFile(upload.fileId);
        if (!current || current.version !== upload.baseVersion) throw new Error("version_conflict");
        const version = current.version + 1;
        this.database.prepare(`
          INSERT INTO file_versions(file_id, version, mime, size, sha256, origin, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(current.fileId, version, detectedMime, content.length, digest, upload.origin, timestamp);
        this.database.prepare(`
          UPDATE files SET mime = ?, size = ?, sha256 = ?, version = ?, origin = ?, updated_at = ?
          WHERE file_id = ?
        `).run(detectedMime, content.length, digest, version, upload.origin, timestamp, current.fileId);
        completed = this.getFile(current.fileId)!;
      } else {
        const fileId = randomUUID();
        this.database.prepare(`
          INSERT INTO files(
            file_id, workspace_id, relative_path, mime, size, sha256, version,
            origin, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
        `).run(
          fileId,
          upload.workspaceId,
          upload.relativePath,
          detectedMime,
          content.length,
          digest,
          upload.origin,
          timestamp,
          timestamp,
        );
        this.database.prepare(`
          INSERT INTO file_versions(file_id, version, mime, size, sha256, origin, created_at)
          VALUES (?, 1, ?, ?, ?, ?, ?)
        `).run(fileId, detectedMime, content.length, digest, upload.origin, timestamp);
        completed = this.getFile(fileId)!;
      }
      this.database
        .prepare("UPDATE uploads SET status = 'complete', file_id = ? WHERE upload_id = ?")
        .run(completed.fileId, uploadId);
      return completed;
    })();

    rmSync(path.join(this.uploadRoot, uploadId), { recursive: true, force: true });
    return file;
  }

  getFile(fileId: string): WorkspaceFile | null {
    const row = this.database.prepare("SELECT * FROM files WHERE file_id = ?").get(fileId);
    return row ? mapFile(row) : null;
  }

  listFiles(workspaceId: string, options: { includeDeleted?: boolean } = {}): WorkspaceFile[] {
    const rows = this.database.prepare(
      `SELECT * FROM files WHERE workspace_id = ? ${options.includeDeleted ? "" : "AND deleted_at IS NULL"}
       ORDER BY relative_path`,
    ).all(assertId(workspaceId, "invalid_workspace_id"));
    return rows.map(mapFile);
  }

  listVersions(fileId: string): WorkspaceFileVersion[] {
    return this.database
      .prepare("SELECT * FROM file_versions WHERE file_id = ? ORDER BY version DESC")
      .all(fileId)
      .map(mapVersion);
  }

  readFileContent(fileId: string, version?: number): Buffer {
    const file = this.getFile(fileId);
    if (!file || file.deletedAt) throw new Error("file_not_found");
    const selected = version
      ? (this.database
          .prepare("SELECT * FROM file_versions WHERE file_id = ? AND version = ?")
          .get(fileId, version) as Record<string, unknown> | undefined)
      : { sha256: file.sha256 };
    if (!selected) throw new Error("file_version_not_found");
    const digest = String(selected.sha256);
    return readFileSync(path.join(this.contentRoot, digest.slice(0, 2), digest));
  }

  deleteFile(fileId: string): WorkspaceFile {
    const file = this.getFile(fileId);
    if (!file || file.deletedAt) throw new Error("file_not_found");
    const timestamp = now();
    this.database
      .prepare("UPDATE files SET deleted_at = ?, updated_at = ? WHERE file_id = ?")
      .run(timestamp, timestamp, fileId);
    return this.getFile(fileId)!;
  }

  purgeExpiredUploads(referenceTime = now()): number {
    const rows = this.database
      .prepare("SELECT upload_id FROM uploads WHERE status = 'open' AND expires_at <= ?")
      .all(referenceTime) as Array<{ upload_id: string }>;
    this.database.transaction(() => {
      for (const row of rows) {
        this.database.prepare("DELETE FROM uploads WHERE upload_id = ?").run(row.upload_id);
        rmSync(path.join(this.uploadRoot, row.upload_id), { recursive: true, force: true });
      }
    })();
    return rows.length;
  }

  private getUpload(uploadId: string): UploadRow | null {
    const row = this.database.prepare("SELECT * FROM uploads WHERE upload_id = ?").get(uploadId) as
      | Record<string, string | number | null>
      | undefined;
    if (!row) return null;
    return {
      uploadId: String(row.upload_id),
      workspaceId: String(row.workspace_id),
      fileId: row.file_id ? String(row.file_id) : null,
      baseVersion: row.base_version === null ? null : Number(row.base_version),
      fileName: String(row.file_name),
      relativePath: String(row.relative_path),
      mime: String(row.mime),
      size: Number(row.size),
      sha256: String(row.sha256),
      origin: row.origin as FileOrigin,
      status: row.status as UploadRow["status"],
      expiresAt: String(row.expires_at),
    };
  }
}
