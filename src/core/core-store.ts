import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getJarvisDataDir } from "./data-dir";
import { redactSecrets } from "./policy";
import type { PrivacyClass } from "./types";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CoreSession {
  sessionId: string;
  createdAt: string;
}

export interface CoreRun {
  runId: string;
  sessionId: string | null;
  agentId: string;
  privacyClass: PrivacyClass;
  requestedModel: string;
  workspace: JsonValue;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CoreMessage {
  messageId: string;
  sessionId: string | null;
  runId: string | null;
  role: string;
  content: JsonValue;
  createdAt: string;
}

export interface CoreEvent {
  eventId: string;
  runId: string;
  seq: number;
  type: string;
  payload: JsonValue;
  createdAt: string;
}

export interface CreateSessionInput {
  sessionId?: string;
  createdAt?: string;
}

export interface CreateRunInput {
  runId?: string;
  sessionId: string;
  agentId: string;
  privacyClass: PrivacyClass;
  requestedModel: string;
  workspace: JsonValue;
  status: string;
  createdAt?: string;
}

export interface CreateMessageInput {
  messageId?: string;
  sessionId: string;
  runId?: string;
  role: string;
  content: JsonValue;
  createdAt?: string;
}

export interface AppendEventInput {
  eventId?: string;
  runId: string;
  type: string;
  payload: JsonValue;
  createdAt?: string;
}

const migrations = [
  {
    version: 1,
    sql: `
  CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    privacy_class TEXT NOT NULL,
    requested_model TEXT NOT NULL,
    workspace_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE messages (
    message_id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
    run_id TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
    role TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE events (
    event_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    seq INTEGER NOT NULL CHECK (seq > 0),
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (run_id, seq)
  );

  CREATE TABLE tool_invocations (
    invocation_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE approvals (
    approval_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    scope TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT
  );

  CREATE TABLE migration_errors (
    source_basename TEXT NOT NULL,
    line_number INTEGER NOT NULL CHECK (line_number > 0),
    error_code TEXT NOT NULL,
    line_sha256 TEXT NOT NULL CHECK (length(line_sha256) = 64),
    PRIMARY KEY (source_basename, line_number)
  );

  CREATE TABLE legacy_imports (
    import_key TEXT PRIMARY KEY,
    imported_at TEXT NOT NULL
  );
`,
  },
] as const;

const sensitiveKey = /^(?:api[_-]?key|token|password|secret|authorization)$/i;

function now(): string {
  return new Date().toISOString();
}

function normalizeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
    return value;
  }
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(normalizeJson);

  const normalized = Object.create(null) as { [key: string]: JsonValue };
  for (const key of Object.keys(value).sort()) {
    normalized[key] = sensitiveKey.test(key)
      ? "[REDACTADO]"
      : normalizeJson(value[key]);
  }
  return normalized;
}

function canonicalJson(value: JsonValue): string {
  return JSON.stringify(normalizeJson(value));
}

function parseJson(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}

function assertText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid legacy record");
  }
  return value as Record<string, unknown>;
}

function asJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(asJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        entry === undefined ? [] : [[key, asJsonValue(entry)]],
      ),
    );
  }
  throw new TypeError("Invalid JSON value");
}

function mapSession(row: unknown): CoreSession | null {
  if (!row) return null;
  const value = row as { session_id: string; created_at: string };
  return { sessionId: value.session_id, createdAt: value.created_at };
}

function mapRun(row: unknown): CoreRun | null {
  if (!row) return null;
  const value = row as {
    run_id: string;
    session_id: string | null;
    agent_id: string;
    privacy_class: PrivacyClass;
    requested_model: string;
    workspace_json: string;
    status: string;
    created_at: string;
    updated_at: string;
  };
  return {
    runId: value.run_id,
    sessionId: value.session_id,
    agentId: value.agent_id,
    privacyClass: value.privacy_class,
    requestedModel: value.requested_model,
    workspace: parseJson(value.workspace_json),
    status: value.status,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function mapMessage(row: unknown): CoreMessage | null {
  if (!row) return null;
  const value = row as {
    message_id: string;
    session_id: string | null;
    run_id: string | null;
    role: string;
    content_json: string;
    created_at: string;
  };
  return {
    messageId: value.message_id,
    sessionId: value.session_id,
    runId: value.run_id,
    role: value.role,
    content: parseJson(value.content_json),
    createdAt: value.created_at,
  };
}

function mapEvent(row: unknown): CoreEvent {
  const value = row as {
    event_id: string;
    run_id: string;
    seq: number;
    type: string;
    payload_json: string;
    created_at: string;
  };
  return {
    eventId: value.event_id,
    runId: value.run_id,
    seq: value.seq,
    type: value.type,
    payload: parseJson(value.payload_json),
    createdAt: value.created_at,
  };
}

function applyMigrations(database: Database.Database): void {
  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const applied = new Set(
      database
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map((row) => (row as { version: number }).version),
    );
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      database.exec(migration.sql);
      database
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(migration.version, now());
    }
  })();
}

function splitLines(source: Buffer): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === 0x0a) {
      lines.push(source.subarray(start, index));
      start = index + 1;
    }
  }
  if (start < source.length) lines.push(source.subarray(start));
  return lines;
}

function legacyModel(alias: unknown): string {
  if (alias === "codex") return "cursor-text";
  return typeof alias === "string" && alias.length > 0 ? alias : "legacy";
}

function legacyEventId(sourceBasename: string, lineNumber: number): string {
  return `legacy-${createHash("sha256")
    .update(`${sourceBasename}\0${lineNumber}`)
    .digest("hex")}`;
}

function ensureLegacyRun(
  database: Database.Database,
  runId: string,
  createdAt: string,
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO runs(
         run_id, session_id, agent_id, privacy_class, requested_model,
         workspace_json, status, created_at, updated_at
       ) VALUES (?, NULL, 'legacy', 'internal', 'legacy', ?, 'running', ?, ?)`,
    )
    .run(runId, canonicalJson({ kind: "none" }), createdAt, createdAt);
}

function importLegacyRun(database: Database.Database, record: Record<string, unknown>): void {
  const run = asRecord(record.run);
  const runId = assertText(run.id, "legacy run id");
  const createdAt =
    typeof run.startedAt === "string" && run.startedAt.length > 0
      ? run.startedAt
      : now();
  const updatedAt =
    typeof run.endedAt === "string" && run.endedAt.length > 0
      ? run.endedAt
      : createdAt;
  const existing = database
    .prepare("SELECT requested_model FROM runs WHERE run_id = ?")
    .get(runId) as { requested_model: string } | undefined;
  const requestedModel =
    typeof run.alias === "string"
      ? legacyModel(run.alias)
      : existing?.requested_model ?? "legacy";

  database
    .prepare(
      `INSERT INTO runs(
         run_id, session_id, agent_id, privacy_class, requested_model,
         workspace_json, status, created_at, updated_at
       ) VALUES (?, NULL, 'legacy', 'internal', ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         requested_model = excluded.requested_model,
         status = excluded.status,
         updated_at = excluded.updated_at`,
    )
    .run(
      runId,
      requestedModel,
      canonicalJson({ kind: "none" }),
      typeof run.status === "string" ? run.status : "running",
      createdAt,
      updatedAt,
    );
}

function importLegacyStep(
  database: Database.Database,
  record: Record<string, unknown>,
  sourceBasename: string,
  lineNumber: number,
): void {
  const step = asRecord(record.step);
  const runId = assertText(step.runId, "legacy step run id");
  const seq = step.seq;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1) {
    throw new TypeError("Invalid legacy step sequence");
  }
  const createdAt =
    typeof step.at === "string" && step.at.length > 0 ? step.at : now();
  ensureLegacyRun(database, runId, createdAt);
  database
    .prepare(
      `INSERT INTO events(event_id, run_id, seq, type, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      legacyEventId(sourceBasename, lineNumber),
      runId,
      seq,
      typeof step.type === "string" ? step.type : "run.step",
      canonicalJson(asJsonValue(step)),
      createdAt,
    );
}

function importLegacyApproval(
  database: Database.Database,
  record: Record<string, unknown>,
): void {
  const approval = asRecord(record.approval);
  const approvalId = assertText(approval.id, "legacy approval id");
  const runId = assertText(approval.runId, "legacy approval run id");
  const createdAt =
    typeof approval.decidedAt === "string" && approval.decidedAt.length > 0
      ? approval.decidedAt
      : now();
  ensureLegacyRun(database, runId, createdAt);
  database
    .prepare(
      `INSERT INTO approvals(
         approval_id, run_id, action, scope, status, payload_json, created_at, decided_at
       ) VALUES (?, ?, ?, ?, 'expired', ?, ?, ?)
       ON CONFLICT(approval_id) DO UPDATE SET
         status = 'expired',
         payload_json = excluded.payload_json,
         decided_at = excluded.decided_at`,
    )
    .run(
      approvalId,
      runId,
      typeof approval.action === "string" ? redactSecrets(approval.action) : "legacy",
      typeof approval.scope === "string" ? redactSecrets(approval.scope) : "legacy",
      canonicalJson(asJsonValue(approval)),
      createdAt,
      typeof approval.decidedAt === "string" ? approval.decidedAt : null,
    );
}

function importLegacyMessage(database: Database.Database, record: Record<string, unknown>): void {
  const message = asRecord(record.message);
  const messageId = assertText(message.id, "legacy message id");
  const runId = typeof message.runId === "string" ? message.runId : null;
  const createdAt =
    typeof message.at === "string" && message.at.length > 0 ? message.at : now();
  if (runId) ensureLegacyRun(database, runId, createdAt);
  const content: { [key: string]: JsonValue } = {
    text: typeof message.text === "string" ? message.text : "",
  };
  if (typeof message.meta === "string") content.meta = message.meta;
  database
    .prepare(
      `INSERT INTO messages(
         message_id, session_id, run_id, role, content_json, created_at
       ) VALUES (?, NULL, ?, ?, ?, ?)`,
    )
    .run(
      messageId,
      runId,
      typeof message.role === "string" ? message.role : "system",
      canonicalJson(content),
      createdAt,
    );
}

function importLegacyRecord(
  database: Database.Database,
  record: Record<string, unknown>,
  sourceBasename: string,
  lineNumber: number,
): void {
  switch (record.type) {
    case "run.start":
    case "run.finish":
      importLegacyRun(database, record);
      return;
    case "run.step":
      importLegacyStep(database, record, sourceBasename, lineNumber);
      return;
    case "approval.request":
    case "approval.decide":
      importLegacyApproval(database, record);
      return;
    case "message.append":
      importLegacyMessage(database, record);
      return;
    default:
      throw new Error("unknown_record_type");
  }
}

function recordMigrationError(
  database: Database.Database,
  sourceBasename: string,
  lineNumber: number,
  errorCode: string,
  rawLine: Buffer,
): void {
  database
    .prepare(
      `INSERT OR REPLACE INTO migration_errors(
         source_basename, line_number, error_code, line_sha256
       ) VALUES (?, ?, ?, ?)`,
    )
    .run(
      sourceBasename,
      lineNumber,
      errorCode,
      createHash("sha256").update(rawLine).digest("hex"),
    );
}

function importLegacySources(database: Database.Database, dataDir: string): void {
  const sources = ["runs.jsonl", "history.jsonl"].flatMap((sourceBasename) => {
    const sourcePath = path.join(dataDir, sourceBasename);
    return existsSync(sourcePath)
      ? [{ sourceBasename, bytes: readFileSync(sourcePath) }]
      : [];
  });
  if (sources.length === 0) return;
  const importLine = database.transaction(
    (record: Record<string, unknown>, sourceBasename: string, lineNumber: number) =>
      importLegacyRecord(database, record, sourceBasename, lineNumber),
  );

  database.transaction(() => {
    const alreadyImported = database
      .prepare("SELECT 1 FROM legacy_imports WHERE import_key = ?")
      .get("v23-jsonl");
    if (alreadyImported) return;

    for (const source of sources) {
      for (const [index, rawLine] of splitLines(source.bytes).entries()) {
        if (rawLine.toString("utf8").trim().length === 0) continue;
        const lineNumber = index + 1;
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawLine.toString("utf8"));
        } catch {
          recordMigrationError(
            database,
            source.sourceBasename,
            lineNumber,
            "malformed_json",
            rawLine,
          );
          continue;
        }

        try {
          importLine(asRecord(parsed), source.sourceBasename, lineNumber);
        } catch (error) {
          recordMigrationError(
            database,
            source.sourceBasename,
            lineNumber,
            error instanceof Error && error.message === "unknown_record_type"
              ? "unknown_record_type"
              : "invalid_record",
            rawLine,
          );
        }
      }
    }
    database
      .prepare("INSERT INTO legacy_imports(import_key, imported_at) VALUES (?, ?)")
      .run("v23-jsonl", now());
  }).immediate();
}

export class CoreStore {
  constructor(private readonly database: Database.Database) {}

  close(): void {
    if (this.database.open) this.database.close();
  }

  /** Narrow seam for local SQLite assertions in persistence tests. */
  getDatabaseForTests(): Database.Database {
    return this.database;
  }

  createSession(input: CreateSessionInput): CoreSession {
    const session: CoreSession = {
      sessionId: assertText(input.sessionId ?? crypto.randomUUID(), "session id"),
      createdAt: input.createdAt ?? now(),
    };
    this.database
      .prepare("INSERT INTO sessions(session_id, created_at) VALUES (?, ?)")
      .run(session.sessionId, session.createdAt);
    return session;
  }

  getSession(sessionId: string): CoreSession | null {
    return mapSession(
      this.database
        .prepare("SELECT * FROM sessions WHERE session_id = ?")
        .get(sessionId),
    );
  }

  createRun(input: CreateRunInput): CoreRun {
    const createdAt = input.createdAt ?? now();
    const runId = assertText(input.runId ?? crypto.randomUUID(), "run id");
    this.database
      .prepare(
        `INSERT INTO runs(
           run_id, session_id, agent_id, privacy_class, requested_model,
           workspace_json, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        assertText(input.sessionId, "session id"),
        assertText(input.agentId, "agent id"),
        input.privacyClass,
        assertText(input.requestedModel, "requested model"),
        canonicalJson(input.workspace),
        assertText(input.status, "run status"),
        createdAt,
        createdAt,
      );
    return this.getRun(runId)!;
  }

  getRun(runId: string): CoreRun | null {
    return mapRun(
      this.database.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId),
    );
  }

  createMessage(input: CreateMessageInput): CoreMessage {
    const messageId = assertText(
      input.messageId ?? crypto.randomUUID(),
      "message id",
    );
    this.database
      .prepare(
        `INSERT INTO messages(
           message_id, session_id, run_id, role, content_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        messageId,
        assertText(input.sessionId, "session id"),
        input.runId ?? null,
        assertText(input.role, "message role"),
        canonicalJson(input.content),
        input.createdAt ?? now(),
      );
    return this.getMessage(messageId)!;
  }

  getMessage(messageId: string): CoreMessage | null {
    return mapMessage(
      this.database
        .prepare("SELECT * FROM messages WHERE message_id = ?")
        .get(messageId),
    );
  }

  appendEvent(input: AppendEventInput): CoreEvent {
    return this.database.transaction(() => {
      const next = this.database
        .prepare(
          "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM events WHERE run_id = ?",
        )
        .get(input.runId) as { seq: number };
      const eventId = assertText(
        input.eventId ?? crypto.randomUUID(),
        "event id",
      );
      this.database
        .prepare(
          `INSERT INTO events(event_id, run_id, seq, type, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          eventId,
          input.runId,
          next.seq,
          assertText(input.type, "event type"),
          canonicalJson(input.payload),
          input.createdAt ?? now(),
        );
      return mapEvent(
        this.database.prepare("SELECT * FROM events WHERE event_id = ?").get(eventId),
      );
    }).immediate();
  }

  replayEvents(runId: string, afterSeq = 0): CoreEvent[] {
    return this.database
      .prepare(
        "SELECT * FROM events WHERE run_id = ? AND seq > ? ORDER BY seq ASC",
      )
      .all(runId, afterSeq)
      .map(mapEvent);
  }
}

let activeStore: CoreStore | null = null;

export function openCoreStore(): CoreStore {
  if (activeStore) return activeStore;
  const dataDir = getJarvisDataDir();
  mkdirSync(dataDir, { recursive: true });
  const database = new Database(path.join(dataDir, "core.db"));
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  database.pragma("foreign_keys = ON");
  try {
    applyMigrations(database);
    importLegacySources(database, dataDir);
    activeStore = new CoreStore(database);
    return activeStore;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function closeCoreStore(): void {
  activeStore?.close();
  activeStore = null;
}
