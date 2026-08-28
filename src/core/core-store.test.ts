import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeCoreStore,
  openCoreStore,
  type CoreStore,
} from "./core-store";

const originalDataDir = process.env.JARVIS_DATA_DIR;
const require = createRequire(import.meta.url);

describe("core-store", () => {
  let dataDir: string;
  let store: CoreStore;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-core-store-"));
    process.env.JARVIS_DATA_DIR = dataDir;
  });

  afterEach(() => {
    closeCoreStore();
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = originalDataDir;
  });

  it("applies numbered migrations and required pragmas", () => {
    store = openCoreStore();

    const database = store.getDatabaseForTests();
    expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(database.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => (row as { name: string }).name),
    ).toEqual([
      "approvals",
      "devices",
      "events",
      "legacy_imports",
      "messages",
      "migration_errors",
      "runs",
      "schema_migrations",
      "sessions",
      "tool_invocations",
    ]);
    expect(
      database
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all()
        .map((row) => (row as { version: number }).version),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(
      database
        .prepare("PRAGMA table_info(sessions)")
        .all()
        .map((row) => (row as { name: string }).name),
    ).toEqual([
      "session_id",
      "created_at",
      "csrf_hash",
      "default_agent_id",
      "expires_at",
      "last_seen_at",
      "device_id",
      "identity_login",
    ]);
  });

  it("persists complete safe sessions and updates last_seen separately", () => {
    store = openCoreStore();
    const session = store.createSafeSession({
      sessionId: "opaque-session",
      csrfHash: "a".repeat(64),
      defaultAgentId: "Hermes",
      expiresAt: "2026-08-09T10:00:00.000Z",
      createdAt: "2026-08-08T10:00:00.000Z",
      lastSeenAt: "2026-08-08T10:00:00.000Z",
    });

    expect(session).toEqual({
      sessionId: "opaque-session",
      csrfHash: "a".repeat(64),
      defaultAgentId: "Hermes",
      expiresAt: "2026-08-09T10:00:00.000Z",
      createdAt: "2026-08-08T10:00:00.000Z",
      lastSeenAt: "2026-08-08T10:00:00.000Z",
      deviceId: null,
      identityLogin: null,
    });

    store.updateSessionLastSeen("opaque-session", "2026-08-08T11:00:00.000Z");
    expect(store.getSession("opaque-session")?.lastSeenAt).toBe(
      "2026-08-08T11:00:00.000Z",
    );
  });

  it("builds session-bound read models for safe-core reload and replay", () => {
    store = openCoreStore();
    const session = store.createSafeSession({
      sessionId: "session-safe",
      csrfHash: "a".repeat(64),
      defaultAgentId: "Hermes",
      expiresAt: "2026-08-09T10:00:00.000Z",
      createdAt: "2026-08-08T10:00:00.000Z",
      lastSeenAt: "2026-08-08T10:00:00.000Z",
    });
    store.createSession({ sessionId: "session-other" });
    const olderRun = store.createRun({
      runId: "run-older",
      sessionId: session.sessionId,
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "local",
      workspace: { kind: "none" },
      status: "completed",
      createdAt: "2026-08-08T10:01:00.000Z",
    });
    const newestRun = store.createRun({
      runId: "run-newest",
      sessionId: session.sessionId,
      agentId: "Planner",
      privacyClass: "confidential",
      requestedModel: "local",
      workspace: { kind: "none" },
      status: "waiting_approval",
      createdAt: "2026-08-08T10:02:00.000Z",
    });
    store.createRun({
      runId: "run-other",
      sessionId: "session-other",
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "local",
      workspace: { kind: "none" },
      status: "running",
    });
    const message = store.createMessage({
      messageId: "message-safe",
      sessionId: session.sessionId,
      runId: newestRun.runId,
      role: "user",
      content: { text: "resume me" },
      createdAt: "2026-08-08T10:03:00.000Z",
    });
    store.createMessage({
      messageId: "message-other",
      sessionId: "session-other",
      runId: "run-other",
      role: "user",
      content: { text: "private to another session" },
    });
    const event = store.appendEvent({
      eventId: "event-safe",
      runId: newestRun.runId,
      type: "tool.approval_required",
      payload: { invocationId: "invocation-safe" },
      createdAt: "2026-08-08T10:04:00.000Z",
    });
    store.createSafeInvocation({
      invocationId: "invocation-safe",
      approvalId: "approval-safe",
      sessionId: session.sessionId,
      runId: newestRun.runId,
      toolId: "file.patch",
      toolVersion: "1.0.0",
      input: { diff: "sanitized" },
      inputDigest: "b".repeat(64),
      workspace: { kind: "none" },
      workspaceDigest: "c".repeat(64),
      bindingDigest: "d".repeat(64),
      effect: { target: "src/a.ts" },
      sideEffect: "local",
      idempotent: false,
      createdAt: "2026-08-08T10:04:00.000Z",
      expiresAt: "2026-08-08T10:14:00.000Z",
    });

    expect(store.updateSessionDefaultAgent(session.sessionId, "Planner")).toMatchObject({
      sessionId: session.sessionId,
      defaultAgentId: "Planner",
    });
    expect(store.listRunsForSession(session.sessionId, 1)).toEqual([newestRun]);
    expect(store.listRunsForSession(session.sessionId, 10)).toEqual([
      newestRun,
      olderRun,
    ]);
    expect(store.listMessagesForRun(session.sessionId, newestRun.runId)).toEqual([
      message,
    ]);
    expect(store.listMessagesForRun("session-other", newestRun.runId)).toEqual([]);
    expect(store.listApprovalsForRun(session.sessionId, newestRun.runId)).toEqual([
      expect.objectContaining({
        approvalId: "approval-safe",
        invocationId: "invocation-safe",
        status: "pending",
      }),
    ]);
    expect(store.listApprovalsForRun("session-other", newestRun.runId)).toEqual([]);
    expect(store.sequenceForEvent(newestRun.runId, event.eventId)).toBe(event.seq);
    expect(store.sequenceForEvent("run-other", event.eventId)).toBeNull();
    expect(() => store.listRunsForSession(session.sessionId, 0)).toThrow(
      "Invalid run list limit",
    );
  });

  it("persists typed sessions, runs and messages across a restart", () => {
    store = openCoreStore();
    store.createSession({
      sessionId: "session-1",
      createdAt: "2026-08-08T10:00:00.000Z",
    });
    store.createRun({
      runId: "run-1",
      sessionId: "session-1",
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "gemini",
      workspace: { path: "/tmp/project", kind: "existing" },
      status: "running",
      createdAt: "2026-08-08T10:01:00.000Z",
    });
    store.createMessage({
      messageId: "message-1",
      sessionId: "session-1",
      runId: "run-1",
      role: "user",
      content: { text: "hello", z: 2, a: 1 },
      createdAt: "2026-08-08T10:02:00.000Z",
    });
    closeCoreStore();

    store = openCoreStore();
    expect(store.getSession("session-1")?.sessionId).toBe("session-1");
    expect(store.getRun("run-1")).toMatchObject({
      runId: "run-1",
      sessionId: "session-1",
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "gemini",
      workspace: { kind: "existing", path: "/tmp/project" },
      status: "running",
    });
    expect(store.getMessage("message-1")?.content).toEqual({
      a: 1,
      text: "hello",
      z: 2,
    });
  });

  it("waits to mark an empty import until a legacy source exists", () => {
    store = openCoreStore();
    expect(
      (
        store
          .getDatabaseForTests()
          .prepare("SELECT count(*) AS count FROM legacy_imports")
          .get() as { count: number }
      ).count,
    ).toBe(0);
    closeCoreStore();

    writeFileSync(
      path.join(dataDir, "history.jsonl"),
      `${JSON.stringify({
        type: "message.append",
        message: {
          id: "late-legacy-message",
          role: "user",
          text: "created after the first open",
          at: "2026-01-01T00:00:00.000Z",
        },
      })}\n`,
    );

    store = openCoreStore();
    expect(store.getMessage("late-legacy-message")?.content).toEqual({
      text: "created after the first open",
    });
    closeCoreStore();

    store = openCoreStore();
    expect(
      (
        store
          .getDatabaseForTests()
          .prepare("SELECT count(*) AS count FROM messages")
          .get() as { count: number }
      ).count,
    ).toBe(1);
  });

  it("requires sessions for new runs and stores redacted canonical JSON", () => {
    const secret = 'alpha"beta\\gamma';
    store = openCoreStore();

    expect(() =>
      store.createRun({
        runId: "orphan",
        sessionId: "missing",
        agentId: "Hermes",
        privacyClass: "secret",
        requestedModel: "local",
        workspace: { kind: "none", token: "do-not-store" },
        status: "running",
      }),
    ).toThrow();

    store.createSession({ sessionId: "session-1" });
    store.createRun({
      runId: "run-1",
      sessionId: "session-1",
      agentId: "Hermes",
      privacyClass: "secret",
      requestedModel: "local",
      workspace: {
        kind: "existing",
        path: "/tmp/project",
        credentials: { apiKey: secret },
        note: `token=${JSON.stringify(secret)}`,
      },
      status: "running",
    });

    const row = (
      store
        .getDatabaseForTests()
        .prepare("SELECT workspace_json AS value FROM runs WHERE run_id = ?")
        .get("run-1") as { value: string }
    ).value;
    expect(row).toBe(
      '{"credentials":{"apiKey":"[REDACTADO]"},"kind":"existing","note":"[REDACTADO]=\\"[REDACTADO]\\"","path":"/tmp/project"}',
    );
    expect(row).not.toContain("alpha");
    expect(row).not.toContain("beta");
    expect(row).not.toContain("gamma");
    expect(JSON.stringify(store.getRun("run-1")?.workspace)).not.toContain("alpha");
    expect(JSON.stringify(store.getRun("run-1")?.workspace)).not.toContain("beta");
    expect(JSON.stringify(store.getRun("run-1")?.workspace)).not.toContain("gamma");
  });

  it("appends monotonic events and replays strictly after a sequence", () => {
    store = openCoreStore();
    store.createSession({ sessionId: "session-1" });
    store.createRun({
      runId: "run-1",
      sessionId: "session-1",
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "gemini",
      workspace: { kind: "none" },
      status: "running",
    });

    expect(
      store.appendEvent({
        eventId: "event-1",
        runId: "run-1",
        type: "run.started",
        payload: { token: "do-not-store", ok: true },
      }).seq,
    ).toBe(1);
    expect(store.replayEvents("run-1")[0]?.v).toBe(1);
    expect(
      (
        store
          .getDatabaseForTests()
          .prepare("SELECT protocol_version AS version FROM events WHERE event_id = ?")
          .get("event-1") as { version: number }
      ).version,
    ).toBe(1);
    expect(
      store.appendEvent({
        eventId: "event-2",
        runId: "run-1",
        type: "run.progress",
        payload: { step: 2 },
      }).seq,
    ).toBe(2);
    expect(store.replayEvents("run-1", 1).map((event) => event.seq)).toEqual([2]);
    expect(store.replayEvents("run-1", 0)[0].payload).toEqual({
      ok: true,
      token: "[REDACTADO]",
    });

    expect(() =>
      store.appendEvent({
        eventId: "event-2",
        runId: "run-1",
        type: "duplicate",
        payload: {},
      }),
    ).toThrow();

    store.createRun({
      runId: "run-2",
      sessionId: "session-1",
      agentId: "Planner",
      privacyClass: "internal",
      requestedModel: "gemini",
      workspace: { kind: "none" },
      status: "running",
    });
    expect(() =>
      store.appendEvent({
        eventId: "event-1",
        runId: "run-2",
        type: "duplicate-global-id",
        payload: {},
      }),
    ).toThrow();
    expect(() =>
      store
        .getDatabaseForTests()
        .prepare(
          `INSERT INTO events(event_id, run_id, seq, type, payload_json, created_at)
           VALUES ('event-3', 'run-1', 2, 'duplicate-seq', '{}', '2026-08-08')`,
        )
        .run(),
    ).toThrow();
  });

  it("imports both legacy files once, records safe errors and preserves sources", () => {
    const runsSource = [
      JSON.stringify({
        type: "run.start",
        run: {
          id: "legacy-cursor",
          kind: "chat",
          alias: "codex",
          startedAt: "2026-01-01T00:00:00.000Z",
          status: "running",
        },
      }),
      JSON.stringify({
        type: "run.step",
        step: {
          runId: "legacy-cursor",
          seq: 1,
          type: "route",
          summary: "token=do-not-store",
          at: "2026-01-01T00:00:01.000Z",
        },
      }),
      JSON.stringify({
        type: "approval.request",
        approval: {
          id: "approval-1",
          runId: "legacy-cursor",
          action: "terminal.run",
          scope: "workspace",
          decision: "pending",
        },
      }),
      JSON.stringify({
        type: "approval.decide",
        approval: {
          id: "approval-1",
          runId: "legacy-cursor",
          action: "terminal.run",
          scope: "workspace",
          decision: "approved",
        },
      }),
      JSON.stringify({ type: "future.record", value: 1 }),
      "{malformed",
      JSON.stringify({
        type: "run.finish",
        run: {
          id: "legacy-cursor",
          kind: "chat",
          alias: "codex",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: "2026-01-01T00:01:00.000Z",
          status: "ok",
        },
      }),
      JSON.stringify({
        type: "run.start",
        run: {
          id: "legacy-gemini",
          kind: "chat",
          alias: "gemini",
          startedAt: "2026-01-01T00:02:00.000Z",
          status: "running",
        },
      }),
    ].join("\n");
    const historySource = `${JSON.stringify({
      type: "message.append",
      message: {
        id: "message-legacy",
        role: "assistant",
        text: "legacy hello",
        meta: "source",
        at: "2026-01-01T00:00:02.000Z",
        runId: "legacy-cursor",
      },
    })}\n`;
    const runsPath = path.join(dataDir, "runs.jsonl");
    const historyPath = path.join(dataDir, "history.jsonl");
    writeFileSync(runsPath, runsSource);
    writeFileSync(historyPath, historySource);

    store = openCoreStore();

    expect(store.getRun("legacy-cursor")).toMatchObject({
      sessionId: null,
      requestedModel: "cursor-text",
      status: "ok",
    });
    expect(store.getRun("legacy-gemini")?.requestedModel).toBe("gemini");
    const importedEvents = store.replayEvents("legacy-cursor", 0);
    expect(importedEvents).toHaveLength(1);
    expect(JSON.stringify(importedEvents[0].payload)).not.toContain("do-not-store");
    expect(
      (
        store
          .getDatabaseForTests()
          .prepare("SELECT payload_json AS payload FROM events WHERE run_id = ?")
          .get("legacy-cursor") as { payload: string }
      ).payload,
    ).not.toContain("do-not-store");
    expect(store.getMessage("message-legacy")?.content).toEqual({
      meta: "source",
      text: "legacy hello",
    });
    expect(
      (
        store
          .getDatabaseForTests()
          .prepare("SELECT status FROM approvals WHERE approval_id = ?")
          .get("approval-1") as { status: string }
      ).status,
    ).toBe("expired");
    expect(
      store
        .getDatabaseForTests()
        .prepare(
          `SELECT source_basename AS sourceBasename,
                  line_number AS lineNumber,
                  error_code AS errorCode,
                  line_sha256 AS lineSha256
             FROM migration_errors
            ORDER BY source_basename, line_number`,
        )
        .all(),
    ).toEqual([
      {
        sourceBasename: "runs.jsonl",
        lineNumber: 5,
        errorCode: "unknown_record_type",
        lineSha256: createHash("sha256")
          .update(JSON.stringify({ type: "future.record", value: 1 }))
          .digest("hex"),
      },
      {
        sourceBasename: "runs.jsonl",
        lineNumber: 6,
        errorCode: "malformed_json",
        lineSha256: createHash("sha256").update("{malformed").digest("hex"),
      },
    ]);
    expect(
      JSON.stringify(
        store.getDatabaseForTests().prepare("SELECT * FROM migration_errors").all(),
      ),
    ).not.toContain("{malformed");
    expect(readFileSync(runsPath, "utf8")).toBe(runsSource);
    expect(readFileSync(historyPath, "utf8")).toBe(historySource);

    closeCoreStore();
    store = openCoreStore();
    const database = store.getDatabaseForTests();
    expect({
      runs: (database.prepare("SELECT count(*) AS count FROM runs").get() as { count: number }).count,
      messages: (database.prepare("SELECT count(*) AS count FROM messages").get() as { count: number }).count,
      events: (database.prepare("SELECT count(*) AS count FROM events").get() as { count: number }).count,
      approvals: (database.prepare("SELECT count(*) AS count FROM approvals").get() as { count: number }).count,
      migrationErrors: (
        database.prepare("SELECT count(*) AS count FROM migration_errors").get() as { count: number }
      ).count,
      legacyImports: (
        database.prepare("SELECT count(*) AS count FROM legacy_imports").get() as { count: number }
      ).count,
    }).toMatchObject({
      runs: 2,
      messages: 1,
      events: 1,
      approvals: 1,
      migrationErrors: 2,
      legacyImports: 1,
    });
  });

  it("checks the import marker after acquiring the immediate transaction", async () => {
    store = openCoreStore();
    store
      .getDatabaseForTests()
      .prepare("DELETE FROM legacy_imports")
      .run();
    closeCoreStore();
    writeFileSync(
      path.join(dataDir, "history.jsonl"),
      `${JSON.stringify({
        type: "message.append",
        message: {
          id: "must-not-be-imported-twice",
          role: "user",
          text: "already owned by the first opener",
          at: "2026-01-01T00:00:00.000Z",
        },
      })}\n`,
    );

    const worker = new Worker(
      `
        const { parentPort, workerData } = require("node:worker_threads");
        const Database = require(workerData.sqliteModule);
        const database = new Database(workerData.databasePath);
        database.pragma("busy_timeout = 5000");
        database.exec("BEGIN IMMEDIATE");
        parentPort.postMessage("locked");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
        database.prepare(
          "INSERT INTO legacy_imports(import_key, imported_at) VALUES (?, ?)",
        ).run("v23-jsonl", "2026-01-01T00:00:00.000Z");
        database.exec("COMMIT");
        database.close();
      `,
      {
        eval: true,
        workerData: {
          databasePath: path.join(dataDir, "core.db"),
          sqliteModule: require.resolve("better-sqlite3"),
        },
      },
    );
    const workerExit = new Promise<void>((resolve, reject) => {
      worker.once("error", reject);
      worker.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)),
      );
    });
    await new Promise<void>((resolve, reject) => {
      worker.once("error", reject);
      worker.once("message", (message) =>
        message === "locked"
          ? resolve()
          : reject(new Error(`unexpected worker message: ${message}`)),
      );
    });

    let openError: unknown;
    try {
      store = openCoreStore();
    } catch (error) {
      openError = error;
    }
    await workerExit;

    expect(openError).toBeUndefined();
    expect(store.getMessage("must-not-be-imported-twice")).toBeNull();
    expect(
      (
        store
          .getDatabaseForTests()
          .prepare("SELECT count(*) AS count FROM legacy_imports")
          .get() as { count: number }
      ).count,
    ).toBe(1);
  });

  it("leaves memory and scheduler databases untouched", () => {
    const memoryPath = path.join(dataDir, "memory.db");
    const schedulerPath = path.join(dataDir, "scheduler.json");
    writeFileSync(memoryPath, "memory-source-bytes");
    writeFileSync(schedulerPath, "scheduler-source-bytes");

    store = openCoreStore();

    expect(readFileSync(memoryPath, "utf8")).toBe("memory-source-bytes");
    expect(readFileSync(schedulerPath, "utf8")).toBe("scheduler-source-bytes");
  });
});
