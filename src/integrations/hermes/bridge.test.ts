import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeCoreStore, openCoreStore, type CoreStore } from "@/core/core-store";
import {
  createHermesBridge,
  type HermesAttachment,
} from "./bridge";
import type { HermesGatewayClient, HermesRpcEvent } from "./gateway-client";

const originalDataDir = process.env.JARVIS_DATA_DIR;

class FakeGateway {
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  private listener: ((event: HermesRpcEvent) => void) | null = null;
  ready = true;

  async connect(): Promise<void> {
    this.ready = true;
  }

  close(): void {
    this.ready = false;
  }

  onEvent(listener: (event: HermesRpcEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    if (method === "session.create") {
      return { session_id: "hermes-1" } as T;
    }
    return {} as T;
  }

  emit(event: HermesRpcEvent): void {
    this.listener?.(event);
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createHermesBridge", () => {
  let dataDir: string;
  let store: CoreStore;
  let client: FakeGateway;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-hermes-bridge-"));
    process.env.JARVIS_DATA_DIR = dataDir;
    store = openCoreStore();
    store.createSafeSession({
      sessionId: "sess-1",
      csrfHash: "a".repeat(64),
      defaultAgentId: "Hermes",
      expiresAt: "2099-01-01T00:00:00.000Z",
      createdAt: "2026-08-25T00:00:00.000Z",
      lastSeenAt: "2026-08-25T00:00:00.000Z",
    });
    store.createRun({
      runId: "run-1",
      sessionId: "sess-1",
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "local",
      workspace: { kind: "none" },
      status: "pending",
    });
    store.createMessage({
      sessionId: "sess-1",
      runId: "run-1",
      role: "user",
      content: { text: "oi" },
    });
    client = new FakeGateway();
  });

  afterEach(() => {
    closeCoreStore();
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = originalDataDir;
  });

  function bridge() {
    return createHermesBridge({
      store,
      client: client as unknown as HermesGatewayClient,
    });
  }

  it("persists one assistant message on run.completed using payload text", async () => {
    const port = bridge();
    await port.startTurn({ runId: "run-1", sessionId: "sess-1", prompt: "oi" });
    expect(client.calls[0]?.params).toMatchObject({
      model: "jarvis-broker",
      provider: "jarvis",
    });
    client.emit({
      type: "message.delta",
      session_id: "hermes-1",
      payload: { text: "olá" },
    });
    client.emit({
      type: "message.complete",
      session_id: "hermes-1",
      payload: { status: "ok", text: "olá mundo" },
    });
    await flush();
    client.emit({
      type: "message.complete",
      session_id: "hermes-1",
      payload: { status: "ok", text: "duplicado" },
    });
    await flush();

    const messages = store.listMessagesForRun("sess-1", "run-1");
    const assistants = messages.filter((message) => message.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.content).toEqual({ text: "olá mundo" });
  });

  it("falls back to concatenated text.delta when complete has no text", async () => {
    const port = bridge();
    await port.startTurn({ runId: "run-1", sessionId: "sess-1", prompt: "oi" });
    client.emit({
      type: "text.delta",
      session_id: "hermes-1",
      payload: { text: "parte" },
    });
    client.emit({
      type: "message.complete",
      session_id: "hermes-1",
      payload: { status: "complete" },
    });
    await flush();

    const assistants = store
      .listMessagesForRun("sess-1", "run-1")
      .filter((message) => message.role === "assistant");
    expect(assistants[0]?.content).toEqual({ text: "parte" });
  });

  it("attaches files and images before prompt.submit", async () => {
    const port = bridge();
    const attachments: HermesAttachment[] = [
      { kind: "image", path: "/tmp/shot.png" },
      { kind: "file", path: "/tmp/note.md" },
      { kind: "image-bytes", contentBase64: "aGVsbG8=", filename: "paste.png" },
    ];
    await port.startTurn({
      runId: "run-1",
      sessionId: "sess-1",
      prompt: "veja",
      attachments,
    });
    expect(client.calls.map((call) => call.method)).toEqual([
      "session.create",
      "image.attach",
      "file.attach",
      "image.attach_bytes",
      "prompt.submit",
    ]);
    expect(client.calls[1]?.params).toMatchObject({
      session_id: "hermes-1",
      path: "/tmp/shot.png",
    });
    expect(client.calls[3]?.params).toMatchObject({
      session_id: "hermes-1",
      filename: "paste.png",
      content_base64: "aGVsbG8=",
    });
  });

  it("resumes a Hermes session without creating a new one", async () => {
    const port = bridge();
    await port.resumeSession({ runId: "run-1", hermesSessionId: "hermes-live" });
    expect(client.calls).toEqual([
      {
        method: "session.resume",
        params: { session_id: "hermes-live" },
      },
    ]);
    client.emit({
      type: "message.complete",
      session_id: "hermes-live",
      payload: { status: "ok", text: "histórico" },
    });
    await flush();
    const assistants = store
      .listMessagesForRun("sess-1", "run-1")
      .filter((message) => message.role === "assistant");
    expect(assistants[0]?.content).toEqual({ text: "histórico" });
  });

  it("steers and interrupts subagents and answers clarify", async () => {
    const port = bridge();
    await port.startTurn({ runId: "run-1", sessionId: "sess-1", prompt: "oi" });
    client.calls = [];
    await port.steerSubagent({
      runId: "run-1",
      subagentId: "child-1",
      text: "foca no teste",
    });
    await port.interruptSubagent({ runId: "run-1", subagentId: "child-1" });
    await port.respondClarify({
      runId: "run-1",
      requestId: "q1",
      text: "sim",
    });
    expect(client.calls.map((call) => call.method)).toEqual([
      "subagent.steer",
      "subagent.interrupt",
      "clarify.respond",
    ]);
  });
});
