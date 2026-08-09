import { homedir } from "node:os";
import type { CoreEvent, CoreStore, JsonValue } from "./core-store";
import { redactStructured } from "./policy";
import type { SafeEventEnvelope } from "./safe-api-contract";

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
]);
const encoder = new TextEncoder();

type Wait = (ms: number, signal: AbortSignal) => Promise<void>;

function safePrivatePaths(privatePaths: readonly string[]): string[] {
  return [...new Set([...privatePaths, homedir()])]
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length);
}

function replacePrivatePaths(value: string, privatePaths: readonly string[]): string {
  return safePrivatePaths(privatePaths).reduce((current, privatePath) => {
    const replacement = privatePath === homedir() ? "<home>" : "<workspace>";
    return current
      .split(privatePath)
      .join(replacement)
      .split(JSON.stringify(privatePath).slice(1, -1))
      .join(replacement);
  }, value);
}

function sanitizePayload(value: JsonValue, privatePaths: readonly string[]): JsonValue {
  const redacted = redactStructured(value);
  const visit = (entry: JsonValue): JsonValue => {
    if (typeof entry === "string") return replacePrivatePaths(entry, privatePaths);
    if (Array.isArray(entry)) return entry.map(visit);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry).map(([key, child]) => [key, visit(child)]),
      );
    }
    return entry;
  };
  return visit(redacted);
}

export function toSafeEventEnvelope(
  event: CoreEvent,
  privatePaths: readonly string[] = [],
): SafeEventEnvelope {
  return {
    v: event.v,
    eventId: event.eventId,
    runId: event.runId,
    seq: event.seq,
    ts: event.createdAt,
    type: event.type,
    payload: sanitizePayload(event.payload, privatePaths),
  };
}

function assertSseField(value: string, label: string): string {
  if (!value || /[\r\n\0]/.test(value)) throw new TypeError(`invalid_sse_${label}`);
  return value;
}

export function encodeSseEnvelope(envelope: SafeEventEnvelope): string {
  return [
    `id: ${assertSseField(envelope.eventId, "event_id")}`,
    `event: ${assertSseField(envelope.type, "event_type")}`,
    `data: ${JSON.stringify(envelope)}`,
    "",
    "",
  ].join("\n");
}

function defaultWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function streamStoredEvents(options: {
  store: CoreStore;
  runId: string;
  afterSeq: number;
  signal: AbortSignal;
  privatePaths?: readonly string[];
  heartbeatMs?: number;
  pollMs?: number;
  now?: () => Date;
  wait?: Wait;
}): ReadableStream<Uint8Array> {
  if (!Number.isInteger(options.afterSeq) || options.afterSeq < 0) {
    throw new TypeError("invalid_event_sequence");
  }
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const pollMs = options.pollMs ?? 250;
  if (heartbeatMs <= 0 || pollMs <= 0) throw new TypeError("invalid_stream_interval");
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? defaultWait;
  const internalAbort = new AbortController();
  const abortFromRequest = () => internalAbort.abort(options.signal.reason);
  if (options.signal.aborted) abortFromRequest();
  else options.signal.addEventListener("abort", abortFromRequest, { once: true });

  let controllerClosed = false;
  const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (controllerClosed) return;
    controllerClosed = true;
    controller.close();
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let lastSeq = options.afterSeq;
        let lastEmissionMs = now().getTime();
        try {
          while (!internalAbort.signal.aborted) {
            const events = options.store.replayEvents(options.runId, lastSeq);
            for (const event of events) {
              if (internalAbort.signal.aborted) break;
              controller.enqueue(
                encoder.encode(
                  encodeSseEnvelope(
                    toSafeEventEnvelope(event, options.privatePaths),
                  ),
                ),
              );
              lastSeq = event.seq;
              lastEmissionMs = now().getTime();
            }
            if (internalAbort.signal.aborted) break;

            const run = options.store.getRun(options.runId);
            if (!run || TERMINAL_RUN_STATUSES.has(run.status)) {
              close(controller);
              return;
            }

            const elapsed = now().getTime() - lastEmissionMs;
            if (elapsed >= heartbeatMs) {
              controller.enqueue(
                encoder.encode(`: heartbeat ${now().toISOString()}\n\n`),
              );
              lastEmissionMs = now().getTime();
              continue;
            }
            await wait(
              Math.min(pollMs, Math.max(1, heartbeatMs - elapsed)),
              internalAbort.signal,
            );
          }
          close(controller);
        } catch (error) {
          if (internalAbort.signal.aborted) close(controller);
          else {
            controllerClosed = true;
            controller.error(error);
          }
        } finally {
          options.signal.removeEventListener("abort", abortFromRequest);
        }
      })();
    },
    cancel() {
      internalAbort.abort("stream_cancelled");
      options.signal.removeEventListener("abort", abortFromRequest);
    },
  });
}

export function singleStoredEventStream(
  event: CoreEvent,
  privatePaths: readonly string[] = [],
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          encodeSseEnvelope(toSafeEventEnvelope(event, privatePaths)),
        ),
      );
      controller.close();
    },
  });
}
