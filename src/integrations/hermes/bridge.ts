import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CoreStore, JsonValue } from "@/core/core-store";
import { mapHermesApproval } from "./approval-map";
import { mapHermesEvent } from "./event-map";
import { HermesGatewayClient, type HermesRpcEvent } from "./gateway-client";

export type HermesAttachment =
  | { kind: "file"; path: string }
  | { kind: "image"; path: string }
  | { kind: "image-bytes"; contentBase64: string; filename?: string };

export interface HermesTurnInput {
  runId: string;
  sessionId: string;
  prompt: string;
  cwd?: string;
  model?: string;
  attachments?: HermesAttachment[];
}

export interface HermesApprovalInput {
  runId: string;
  approvalId: string;
  choice: "once" | "session" | "always" | "deny";
}

export interface HermesBridgePort {
  startTurn(input: HermesTurnInput): Promise<void>;
  resumeSession(input: { runId: string; hermesSessionId: string }): Promise<void>;
  interrupt(runId: string): Promise<void>;
  respondApproval(input: HermesApprovalInput): Promise<void>;
  steerSubagent(input: { runId: string; subagentId: string; text: string }): Promise<void>;
  interruptSubagent(input: { runId: string; subagentId: string }): Promise<void>;
  respondClarify(input: { runId: string; requestId: string; text: string }): Promise<void>;
  startWake(): Promise<void>;
  speak(text: string): Promise<void>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

let lastVoice = { text: "", at: "" };

export function peekHermesVoice(): { text: string; at: string } {
  return lastVoice;
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function defaultCwd(): string {
  return process.env.HERMES_DEFAULT_CWD?.trim() || join(homedir(), "Projetos");
}

/** Hermes always targets this private provider; Jarvis selects the real model. */
export function jarvisBrokerModel(): string {
  return process.env.HERMES_JARVIS_BROKER_MODEL?.trim() || "jarvis-broker";
}

function sessionFromEvent(event: HermesRpcEvent): string {
  if (typeof event.session_id === "string" && event.session_id) return event.session_id;
  const payload = event.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const sessionId = (payload as { session_id?: unknown }).session_id;
    if (typeof sessionId === "string") return sessionId;
  }
  return "";
}

function payloadText(payload: JsonValue): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  return typeof payload.text === "string" ? payload.text : "";
}

function persistAssistant(store: CoreStore, runId: string, sessionId: string, text: string): void {
  const existing = store
    .listMessagesForRun(sessionId, runId)
    .some((message) => message.role === "assistant");
  if (existing) return;
  store.createMessage({
    sessionId,
    runId,
    role: "assistant",
    content: { text },
  });
}

export function createHermesBridge(options: {
  store: CoreStore;
  client?: HermesGatewayClient;
}): HermesBridgePort {
  const client = options.client ?? new HermesGatewayClient();
  const hermesByRun = new Map<string, string>();
  const runByHermes = new Map<string, string>();
  const deltaByRun = new Map<string, string>();
  let attached = false;

  function bind(runId: string, hermesSessionId: string): void {
    hermesByRun.set(runId, hermesSessionId);
    runByHermes.set(hermesSessionId, runId);
  }

  async function ready(): Promise<void> {
    if (!attached) {
      attached = true;
      client.onEvent((event) => {
        void onEvent(event);
      });
    }
    await client.connect();
  }

  async function attachAll(
    hermesSessionId: string,
    attachments: HermesAttachment[] | undefined,
  ): Promise<void> {
    for (const item of attachments ?? []) {
      if (item.kind === "image") {
        await client.request("image.attach", {
          session_id: hermesSessionId,
          path: item.path,
        });
      } else if (item.kind === "file") {
        await client.request("file.attach", {
          session_id: hermesSessionId,
          path: item.path,
        });
      } else {
        await client.request("image.attach_bytes", {
          session_id: hermesSessionId,
          content_base64: item.contentBase64,
          filename: item.filename,
        });
      }
    }
  }

  async function onEvent(raw: HermesRpcEvent): Promise<void> {
    const mapped = mapHermesEvent(raw);
    if (mapped?.type === "voice.transcript" || mapped?.type === "voice.wake") {
      const payload = mapped.payload;
      const text =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? String((payload as { text?: unknown }).text ?? "")
          : "";
      if (text) lastVoice = { text, at: new Date().toISOString() };
    }

    const hermesSessionId = sessionFromEvent(raw);
    const runId = hermesSessionId ? runByHermes.get(hermesSessionId) : undefined;
    if (!runId || !mapped) return;
    const run = options.store.getRun(runId);
    if (!run) return;

    if (mapped.type === "text.delta") {
      const chunk = payloadText(mapped.payload);
      if (chunk) deltaByRun.set(runId, `${deltaByRun.get(runId) ?? ""}${chunk}`);
    }

    if (mapped.type === "tool.approval_required") {
      const view = mapHermesApproval({
        payload: raw.payload ?? mapped.payload,
        createdAt: new Date().toISOString(),
      });
      if (view && run.sessionId) {
        const input: JsonValue = {
          command: (view.target as { command?: string }).command ?? "",
        };
        try {
          options.store.createSafeInvocation({
            invocationId: view.invocationId,
            approvalId: view.approvalId,
            sessionId: run.sessionId,
            runId,
            toolId: view.toolId,
            toolVersion: "hermes",
            input,
            inputDigest: sha(JSON.stringify(input)),
            workspace: (run.workspace as JsonValue) ?? null,
            workspaceDigest: sha(JSON.stringify(run.workspace ?? {})),
            bindingDigest: sha(`${runId}:${view.approvalId}`),
            effect: view.effect,
            sideEffect: "local",
            idempotent: false,
            createdAt: view.createdAt,
            expiresAt: view.expiresAt,
          });
        } catch {
          // Persist the SSE event even if the invocation row already exists.
        }
      }
    }

    options.store.appendEvent({
      runId,
      type: mapped.type,
      payload: mapped.payload,
    });

    const sessionId = run.sessionId;
    if (!sessionId) return;
    try {
      if (mapped.type === "run.completed") {
        options.store.transitionRunStatus({
          runId,
          sessionId,
          from: ["pending", "running", "waiting_approval"],
          to: "completed",
        });
        persistAssistant(
          options.store,
          runId,
          sessionId,
          payloadText(mapped.payload) || deltaByRun.get(runId) || "",
        );
        deltaByRun.delete(runId);
      } else if (mapped.type === "run.failed") {
        options.store.transitionRunStatus({
          runId,
          sessionId,
          from: ["pending", "running", "waiting_approval"],
          to: "failed",
        });
      } else if (mapped.type === "abort") {
        options.store.transitionRunStatus({
          runId,
          sessionId,
          from: ["pending", "running", "waiting_approval"],
          to: "cancelled",
        });
      } else if (mapped.type === "tool.approval_required") {
        options.store.transitionRunStatus({
          runId,
          sessionId,
          from: ["pending", "running"],
          to: "waiting_approval",
        });
      }
    } catch {
      if (mapped.type === "run.completed") {
        persistAssistant(
          options.store,
          runId,
          sessionId,
          payloadText(mapped.payload) || deltaByRun.get(runId) || "",
        );
      }
    }
  }

  return {
    async startTurn(input) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await ready();
          const created = await client.request<{ session_id?: string; id?: string }>(
            "session.create",
            {
              cwd: input.cwd || defaultCwd(),
              title: `jarvis:${input.runId}`,
              source: "jarvis",
              model: jarvisBrokerModel(),
              provider: "jarvis",
            },
          );
          const hermesSessionId = created.session_id ?? created.id;
          if (!hermesSessionId) throw new Error("hermes_session_missing");
          bind(input.runId, hermesSessionId);
          await attachAll(hermesSessionId, input.attachments);
          await client.request("prompt.submit", {
            session_id: hermesSessionId,
            text: input.prompt,
          });
          return;
        } catch (error) {
          lastError = error;
          client.close();
        }
      }
      throw lastError instanceof Error ? lastError : new Error("hermes_start_failed");
    },
    async resumeSession(input) {
      await ready();
      bind(input.runId, input.hermesSessionId);
      await client.request("session.resume", { session_id: input.hermesSessionId });
    },
    async interrupt(runId) {
      const hermesSessionId = hermesByRun.get(runId);
      if (!hermesSessionId) return;
      await ready();
      await client.request("session.interrupt", { session_id: hermesSessionId });
    },
    async respondApproval(input) {
      const hermesSessionId = hermesByRun.get(input.runId);
      if (!hermesSessionId) return;
      await ready();
      await client.request("approval.respond", {
        session_id: hermesSessionId,
        request_id: input.approvalId,
        choice: input.choice,
      });
    },
    async steerSubagent(input) {
      const hermesSessionId = hermesByRun.get(input.runId);
      if (!hermesSessionId) return;
      await ready();
      await client.request("subagent.steer", {
        session_id: hermesSessionId,
        subagent_id: input.subagentId,
        text: input.text,
      });
    },
    async interruptSubagent(input) {
      const hermesSessionId = hermesByRun.get(input.runId);
      if (!hermesSessionId) return;
      await ready();
      await client.request("subagent.interrupt", {
        session_id: hermesSessionId,
        subagent_id: input.subagentId,
      });
    },
    async respondClarify(input) {
      const hermesSessionId = hermesByRun.get(input.runId);
      if (!hermesSessionId) return;
      await ready();
      await client.request("clarify.respond", {
        session_id: hermesSessionId,
        request_id: input.requestId,
        text: input.text,
      });
    },
    async startWake() {
      await ready();
      await client.request("wake.start", {
        surface: "gui",
        persist: true,
        client_capture: true,
      });
    },
    async speak(text) {
      await ready();
      await client.request("voice.tts", { text });
    },
    async health() {
      try {
        await ready();
        return { ok: client.ready };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : "hermes_unreachable",
        };
      }
    },
  };
}

let singleton: HermesBridgePort | null = null;

export function getHermesBridge(store: CoreStore, client?: HermesGatewayClient): HermesBridgePort {
  singleton ??= createHermesBridge({ store, client });
  return singleton;
}

export function resetHermesBridgeForTests(): void {
  singleton = null;
}
