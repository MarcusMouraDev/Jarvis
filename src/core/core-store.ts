import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getJarvisDataDir } from "./data-dir";
import { redactSecrets, redactStructured } from "./policy";
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
  csrfHash: string | null;
  defaultAgentId: string | null;
  expiresAt: string | null;
  lastSeenAt: string | null;
}

export interface SafeCoreSession extends CoreSession {
  csrfHash: string;
  defaultAgentId: string;
  expiresAt: string;
  lastSeenAt: string;
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
  v: 1;
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

export interface CreateSafeSessionInput {
  sessionId: string;
  csrfHash: string;
  defaultAgentId: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
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

export interface SafeToolInvocation {
  invocationId: string;
  sessionId: string;
  runId: string;
  toolId: string;
  toolVersion: string;
  input: JsonValue;
  inputDigest: string;
  workspace: JsonValue;
  workspaceDigest: string;
  bindingDigest: string;
  effect: JsonValue;
  sideEffect: "none" | "local" | "external";
  idempotent: boolean;
  status: string;
  output: JsonValue | null;
  error: JsonValue | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SafeToolApproval {
  approvalId: string;
  sessionId: string;
  runId: string;
  invocationId: string;
  toolId: string;
  toolVersion: string;
  bindingDigest: string;
  effect: JsonValue;
  status: "pending" | "approved" | "denied" | "expired" | "consumed";
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  consumedAt: string | null;
}

export interface CreateSafeInvocationInput {
  invocationId: string;
  approvalId?: string;
  sessionId: string;
  runId: string;
  toolId: string;
  toolVersion: string;
  input: JsonValue;
  inputDigest: string;
  workspace: JsonValue;
  workspaceDigest: string;
  bindingDigest: string;
  effect: JsonValue;
  sideEffect: "none" | "local" | "external";
  idempotent: boolean;
  createdAt: string;
  expiresAt?: string;
}

export interface ClaimSafeInvocationInput {
  invocationId: string;
  sessionId: string;
  runId: string;
  toolId: string;
  toolVersion: string;
  input: JsonValue;
  inputDigest: string;
  workspace: JsonValue;
  workspaceDigest: string;
  bindingDigest: string;
  effect: JsonValue;
  sideEffect: "none" | "local" | "external";
  idempotent: boolean;
  now: string;
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
  {
    version: 2,
    sql: `
  ALTER TABLE sessions ADD COLUMN csrf_hash TEXT;
  ALTER TABLE sessions ADD COLUMN default_agent_id TEXT;
  ALTER TABLE sessions ADD COLUMN expires_at TEXT;
  ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
`,
  },
  {
    version: 3,
    sql: `
  ALTER TABLE tool_invocations ADD COLUMN session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE;
  ALTER TABLE tool_invocations ADD COLUMN tool_version TEXT;
  ALTER TABLE tool_invocations ADD COLUMN input_digest TEXT;
  ALTER TABLE tool_invocations ADD COLUMN workspace_json TEXT;
  ALTER TABLE tool_invocations ADD COLUMN workspace_digest TEXT;
  ALTER TABLE tool_invocations ADD COLUMN binding_digest TEXT;
  ALTER TABLE tool_invocations ADD COLUMN effect_json TEXT;
  ALTER TABLE tool_invocations ADD COLUMN side_effect TEXT;
  ALTER TABLE tool_invocations ADD COLUMN idempotent INTEGER;
  ALTER TABLE tool_invocations ADD COLUMN error_json TEXT;
  ALTER TABLE tool_invocations ADD COLUMN started_at TEXT;
  ALTER TABLE tool_invocations ADD COLUMN completed_at TEXT;

  ALTER TABLE approvals ADD COLUMN session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE;
  ALTER TABLE approvals ADD COLUMN invocation_id TEXT REFERENCES tool_invocations(invocation_id) ON DELETE CASCADE;
  ALTER TABLE approvals ADD COLUMN tool_name TEXT;
  ALTER TABLE approvals ADD COLUMN tool_version TEXT;
  ALTER TABLE approvals ADD COLUMN binding_digest TEXT;
  ALTER TABLE approvals ADD COLUMN effect_json TEXT;
  ALTER TABLE approvals ADD COLUMN expires_at TEXT;
  ALTER TABLE approvals ADD COLUMN consumed_at TEXT;

  CREATE UNIQUE INDEX safe_approval_per_invocation
    ON approvals(invocation_id) WHERE invocation_id IS NOT NULL;
  CREATE UNIQUE INDEX safe_one_effect_per_run
    ON tool_invocations(run_id)
    WHERE side_effect IN ('local', 'external') AND status IN ('executing', 'unknown');

  CREATE TRIGGER safe_approval_insert_status
    BEFORE INSERT ON approvals
    WHEN NEW.invocation_id IS NOT NULL AND NEW.status <> 'pending'
    BEGIN
      SELECT RAISE(ABORT, 'invalid_safe_approval_status');
    END;

  CREATE TRIGGER safe_approval_status_transition
    BEFORE UPDATE OF status ON approvals
    WHEN OLD.invocation_id IS NOT NULL
      AND NEW.status <> OLD.status
      AND NOT (
        (OLD.status = 'pending' AND NEW.status IN ('approved', 'denied', 'expired'))
        OR (OLD.status = 'approved' AND NEW.status IN ('consumed', 'expired'))
      )
    BEGIN
      SELECT RAISE(ABORT, 'invalid_safe_approval_transition');
    END;
`,
  },
  {
    version: 4,
    sql: `
  ALTER TABLE events
    ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1
    CHECK (protocol_version = 1);
`,
  },
] as const;

function now(): string {
  return new Date().toISOString();
}

function sortJson(value: JsonValue): JsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
    return value;
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(sortJson);

  const normalized = Object.create(null) as { [key: string]: JsonValue };
  for (const key of Object.keys(value).sort()) {
    normalized[key] = sortJson(value[key]);
  }
  return normalized;
}

function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortJson(redactStructured(value)));
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
  const value = row as {
    session_id: string;
    created_at: string;
    csrf_hash: string | null;
    default_agent_id: string | null;
    expires_at: string | null;
    last_seen_at: string | null;
  };
  return {
    sessionId: value.session_id,
    createdAt: value.created_at,
    csrfHash: value.csrf_hash,
    defaultAgentId: value.default_agent_id,
    expiresAt: value.expires_at,
    lastSeenAt: value.last_seen_at,
  };
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
    protocol_version: number;
    event_id: string;
    run_id: string;
    seq: number;
    type: string;
    payload_json: string;
    created_at: string;
  };
  if (value.protocol_version !== 1) {
    throw new Error("unsupported_event_protocol_version");
  }
  return {
    v: 1,
    eventId: value.event_id,
    runId: value.run_id,
    seq: value.seq,
    type: value.type,
    payload: parseJson(value.payload_json),
    createdAt: value.created_at,
  };
}

function mapSafeInvocation(row: unknown): SafeToolInvocation | null {
  if (!row) return null;
  const value = row as Record<string, string | number | null>;
  if (!value.session_id || !value.tool_version || !value.input_digest) return null;
  return {
    invocationId: String(value.invocation_id),
    sessionId: String(value.session_id),
    runId: String(value.run_id),
    toolId: String(value.tool_name),
    toolVersion: String(value.tool_version),
    input: parseJson(String(value.input_json)),
    inputDigest: String(value.input_digest),
    workspace: parseJson(String(value.workspace_json)),
    workspaceDigest: String(value.workspace_digest),
    bindingDigest: String(value.binding_digest),
    effect: parseJson(String(value.effect_json)),
    sideEffect: value.side_effect as SafeToolInvocation["sideEffect"],
    idempotent: value.idempotent === 1,
    status: String(value.status),
    output: value.output_json ? parseJson(String(value.output_json)) : null,
    error: value.error_json ? parseJson(String(value.error_json)) : null,
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
    startedAt: value.started_at ? String(value.started_at) : null,
    completedAt: value.completed_at ? String(value.completed_at) : null,
  };
}

function mapSafeApproval(row: unknown): SafeToolApproval | null {
  if (!row) return null;
  const value = row as Record<string, string | null>;
  if (!value.session_id || !value.invocation_id || !value.tool_version) return null;
  return {
    approvalId: String(value.approval_id),
    sessionId: value.session_id,
    runId: String(value.run_id),
    invocationId: value.invocation_id,
    toolId: String(value.tool_name),
    toolVersion: value.tool_version,
    bindingDigest: String(value.binding_digest),
    effect: parseJson(String(value.effect_json)),
    status: value.status as SafeToolApproval["status"],
    createdAt: String(value.created_at),
    expiresAt: String(value.expires_at),
    decidedAt: value.decided_at,
    consumedAt: value.consumed_at,
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
      csrfHash: null,
      defaultAgentId: null,
      expiresAt: null,
      lastSeenAt: null,
    };
    this.database
      .prepare("INSERT INTO sessions(session_id, created_at) VALUES (?, ?)")
      .run(session.sessionId, session.createdAt);
    return session;
  }

  createSafeSession(input: CreateSafeSessionInput): SafeCoreSession {
    if (!/^[a-f\d]{64}$/i.test(input.csrfHash)) {
      throw new TypeError("Invalid CSRF hash");
    }
    const session: SafeCoreSession = {
      sessionId: assertText(input.sessionId, "session id"),
      csrfHash: assertText(input.csrfHash, "CSRF hash"),
      defaultAgentId: assertText(input.defaultAgentId, "default agent id"),
      expiresAt: assertText(input.expiresAt, "session expiry"),
      createdAt: assertText(input.createdAt, "session creation time"),
      lastSeenAt: assertText(input.lastSeenAt, "session last seen time"),
    };
    this.database
      .prepare(
        `INSERT INTO sessions(
           session_id, created_at, csrf_hash, default_agent_id, expires_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.sessionId,
        session.createdAt,
        session.csrfHash,
        session.defaultAgentId,
        session.expiresAt,
        session.lastSeenAt,
      );
    return session;
  }

  getSession(sessionId: string): CoreSession | null {
    return mapSession(
      this.database
        .prepare("SELECT * FROM sessions WHERE session_id = ?")
        .get(sessionId),
    );
  }

  updateSessionLastSeen(sessionId: string, lastSeenAt: string): void {
    this.database
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE session_id = ?")
      .run(assertText(lastSeenAt, "session last seen time"), sessionId);
  }

  updateSessionDefaultAgent(sessionId: string, agentId: string): CoreSession {
    const changed = this.database
      .prepare("UPDATE sessions SET default_agent_id = ? WHERE session_id = ?")
      .run(
        assertText(agentId, "default agent id"),
        assertText(sessionId, "session id"),
      );
    if (changed.changes !== 1) throw new Error("session_not_found");
    return this.getSession(sessionId)!;
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

  listRunsForSession(sessionId: string, limit = 20): CoreRun[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError("Invalid run list limit");
    }
    return this.database
      .prepare(
        `SELECT * FROM runs
         WHERE session_id = ?
         ORDER BY created_at DESC, run_id DESC
         LIMIT ?`,
      )
      .all(assertText(sessionId, "session id"), limit)
      .map((row) => mapRun(row)!);
  }

  transitionRunStatus(input: {
    runId: string;
    sessionId: string;
    from: readonly string[];
    to: string;
    updatedAt?: string;
  }): CoreRun {
    if (input.from.length === 0) throw new TypeError("Run transition requires a source status");
    const placeholders = input.from.map(() => "?").join(", ");
    const changed = this.database
      .prepare(
        `UPDATE runs SET status = ?, updated_at = ?
         WHERE run_id = ? AND session_id = ? AND status IN (${placeholders})`,
      )
      .run(
        assertText(input.to, "run status"),
        input.updatedAt ?? now(),
        assertText(input.runId, "run id"),
        assertText(input.sessionId, "session id"),
        ...input.from.map((status) => assertText(status, "source run status")),
      );
    if (changed.changes !== 1) throw new Error("run_status_transition_failed");
    return this.getRun(input.runId)!;
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

  listMessagesForRun(sessionId: string, runId: string): CoreMessage[] {
    return this.database
      .prepare(
        `SELECT messages.* FROM messages
         INNER JOIN runs ON runs.run_id = messages.run_id
         WHERE runs.session_id = ? AND runs.run_id = ? AND messages.session_id = ?
         ORDER BY messages.created_at ASC, messages.message_id ASC`,
      )
      .all(
        assertText(sessionId, "session id"),
        assertText(runId, "run id"),
        sessionId,
      )
      .map((row) => mapMessage(row)!);
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

  sequenceForEvent(runId: string, eventId: string): number | null {
    const row = this.database
      .prepare("SELECT seq FROM events WHERE run_id = ? AND event_id = ?")
      .get(
        assertText(runId, "run id"),
        assertText(eventId, "event id"),
      ) as { seq: number } | undefined;
    return row?.seq ?? null;
  }

  createSafeInvocation(input: CreateSafeInvocationInput): {
    invocation: SafeToolInvocation;
    approval: SafeToolApproval | null;
  } {
    const digest = (value: string, label: string) => {
      if (!/^[a-f\d]{64}$/i.test(value)) throw new TypeError(`Invalid ${label}`);
      return value;
    };
    return this.database.transaction(() => {
      const needsApproval = input.sideEffect !== "none";
      if (needsApproval && (!input.approvalId || !input.expiresAt)) {
        throw new TypeError("Mutating invocation requires approval");
      }
      this.database
        .prepare(
          `INSERT INTO tool_invocations(
             invocation_id, run_id, tool_name, input_json, output_json, status,
             created_at, updated_at, session_id, tool_version, input_digest,
             workspace_json, workspace_digest, binding_digest, effect_json,
             side_effect, idempotent, error_json, started_at, completed_at
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
        )
        .run(
          assertText(input.invocationId, "invocation id"),
          assertText(input.runId, "run id"),
          assertText(input.toolId, "tool id"),
          canonicalJson(input.input),
          needsApproval ? "waiting_approval" : "executing",
          assertText(input.createdAt, "invocation creation time"),
          input.createdAt,
          assertText(input.sessionId, "session id"),
          assertText(input.toolVersion, "tool version"),
          digest(input.inputDigest, "input digest"),
          canonicalJson(input.workspace),
          digest(input.workspaceDigest, "workspace digest"),
          digest(input.bindingDigest, "binding digest"),
          canonicalJson(input.effect),
          input.sideEffect,
          input.idempotent ? 1 : 0,
          needsApproval ? null : input.createdAt,
        );

      if (needsApproval) {
        this.database
          .prepare(
            `INSERT INTO approvals(
               approval_id, run_id, action, scope, status, payload_json,
               created_at, decided_at, session_id, invocation_id, tool_name,
               tool_version, binding_digest, effect_json, expires_at, consumed_at
             ) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            input.approvalId,
            input.runId,
            input.toolId,
            input.sideEffect,
            canonicalJson({ bindingDigest: input.bindingDigest }),
            input.createdAt,
            input.sessionId,
            input.invocationId,
            input.toolId,
            input.toolVersion,
            input.bindingDigest,
            canonicalJson(input.effect),
            input.expiresAt,
          );
      }

      return {
        invocation: this.getSafeInvocation(input.invocationId)!,
        approval: input.approvalId ? this.getSafeApproval(input.approvalId) : null,
      };
    }).immediate();
  }

  getSafeInvocation(invocationId: string): SafeToolInvocation | null {
    return mapSafeInvocation(
      this.database
        .prepare("SELECT * FROM tool_invocations WHERE invocation_id = ?")
        .get(invocationId),
    );
  }

  getSafeApproval(approvalId: string): SafeToolApproval | null {
    return mapSafeApproval(
      this.database
        .prepare("SELECT * FROM approvals WHERE approval_id = ?")
        .get(approvalId),
    );
  }

  getSafeApprovalForInvocation(invocationId: string): SafeToolApproval | null {
    return mapSafeApproval(
      this.database
        .prepare("SELECT * FROM approvals WHERE invocation_id = ?")
        .get(invocationId),
    );
  }

  listApprovalsForRun(sessionId: string, runId: string): SafeToolApproval[] {
    return this.database
      .prepare(
        `SELECT approvals.* FROM approvals
         INNER JOIN runs ON runs.run_id = approvals.run_id
         WHERE runs.session_id = ? AND runs.run_id = ? AND approvals.session_id = ?
         ORDER BY approvals.created_at ASC, approvals.approval_id ASC`,
      )
      .all(
        assertText(sessionId, "session id"),
        assertText(runId, "run id"),
        sessionId,
      )
      .map((row) => mapSafeApproval(row)!);
  }

  decideSafeApproval(input: {
    approvalId: string;
    sessionId: string;
    decision: "approved" | "denied";
    now: string;
  }): SafeToolApproval {
    return this.database.transaction(() => {
      const approval = this.getSafeApproval(input.approvalId);
      if (!approval || approval.sessionId !== input.sessionId) {
        throw new Error("approval_binding_mismatch");
      }
      if (approval.status !== "pending") throw new Error("approval_not_pending");
      if (approval.expiresAt <= input.now) {
        this.database
          .prepare("UPDATE approvals SET status = 'expired', decided_at = ? WHERE approval_id = ?")
          .run(input.now, input.approvalId);
        this.database
          .prepare("UPDATE tool_invocations SET status = 'expired', updated_at = ? WHERE invocation_id = ?")
          .run(input.now, approval.invocationId);
        return this.getSafeApproval(input.approvalId)!;
      }
      this.database
        .prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE approval_id = ?")
        .run(input.decision, input.now, input.approvalId);
      this.database
        .prepare("UPDATE tool_invocations SET status = ?, updated_at = ? WHERE invocation_id = ?")
        .run(input.decision, input.now, approval.invocationId);
      return this.getSafeApproval(input.approvalId)!;
    }).immediate();
  }

  claimSafeInvocation(input: ClaimSafeInvocationInput): SafeToolInvocation {
    return this.database.transaction(() => {
      const invocation = this.getSafeInvocation(input.invocationId);
      const approval = this.getSafeApprovalForInvocation(input.invocationId);
      const sameJson = (left: JsonValue, right: JsonValue) =>
        canonicalJson(left) === canonicalJson(right);
      if (
        !invocation ||
        !approval ||
        invocation.sessionId !== input.sessionId ||
        invocation.runId !== input.runId ||
        invocation.toolId !== input.toolId ||
        invocation.toolVersion !== input.toolVersion ||
        invocation.inputDigest !== input.inputDigest ||
        invocation.workspaceDigest !== input.workspaceDigest ||
        invocation.bindingDigest !== input.bindingDigest ||
        approval.bindingDigest !== input.bindingDigest ||
        invocation.sideEffect !== input.sideEffect ||
        invocation.idempotent !== input.idempotent ||
        approval.sessionId !== input.sessionId ||
        approval.runId !== input.runId ||
        approval.toolId !== input.toolId ||
        approval.toolVersion !== input.toolVersion ||
        !sameJson(invocation.input, input.input) ||
        !sameJson(invocation.workspace, input.workspace) ||
        !sameJson(invocation.effect, input.effect) ||
        !sameJson(approval.effect, input.effect)
      ) {
        throw new Error("approval_binding_mismatch");
      }
      if (approval.status !== "approved" || invocation.status !== "approved") {
        throw new Error("approval_not_consumable");
      }
      if (approval.expiresAt <= input.now) {
        this.database
          .prepare("UPDATE approvals SET status = 'expired' WHERE approval_id = ?")
          .run(approval.approvalId);
        this.database
          .prepare("UPDATE tool_invocations SET status = 'expired', updated_at = ? WHERE invocation_id = ?")
          .run(input.now, invocation.invocationId);
        throw new Error("approval_expired");
      }
      try {
        this.database
          .prepare(
            "UPDATE tool_invocations SET status = 'executing', started_at = ?, updated_at = ? WHERE invocation_id = ? AND status = 'approved'",
          )
          .run(input.now, input.now, invocation.invocationId);
      } catch (error) {
        if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
          throw new Error("side_effect_already_active");
        }
        throw error;
      }
      const consumed = this.database
        .prepare(
          "UPDATE approvals SET status = 'consumed', consumed_at = ? WHERE approval_id = ? AND status = 'approved'",
        )
        .run(input.now, approval.approvalId);
      if (consumed.changes !== 1) throw new Error("approval_not_consumable");
      return this.getSafeInvocation(invocation.invocationId)!;
    }).immediate();
  }

  finishSafeInvocation(input: {
    invocationId: string;
    status: "completed" | "failed" | "unknown";
    output?: JsonValue;
    error?: JsonValue;
    now: string;
  }): SafeToolInvocation {
    const changed = this.database
      .prepare(
        `UPDATE tool_invocations
         SET status = ?, output_json = ?, error_json = ?, completed_at = ?, updated_at = ?
         WHERE invocation_id = ? AND status = 'executing'`,
      )
      .run(
        input.status,
        input.output === undefined ? null : canonicalJson(input.output),
        input.error === undefined ? null : canonicalJson(input.error),
        input.now,
        input.now,
        input.invocationId,
      );
    if (changed.changes !== 1) throw new Error("invocation_not_executing");
    return this.getSafeInvocation(input.invocationId)!;
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
