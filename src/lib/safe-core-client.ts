import {
  eventEnvelopeSchema,
  type SafeAgentId,
  type SafeEventEnvelope,
} from "@/core/safe-api-contract";

export const CSRF_STORAGE_KEY = "jarvis.safe.csrf";
export const CSRF_HEADER_NAME = "X-Jarvis-CSRF";

export class SafeProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message = `protocol_${code}`) {
    super(message);
    this.name = "SafeProtocolError";
    this.code = code;
  }
}

export interface SafeSessionClient {
  csrfToken: string;
  defaultAgentId: SafeAgentId;
  expiresAt: string;
}

interface StoredCsrf {
  csrfToken: string;
  expiresAt: string;
  defaultAgentId: SafeAgentId;
}

function readStoredSession(): StoredCsrf | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(CSRF_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredCsrf;
    if (
      typeof parsed.csrfToken !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      typeof parsed.defaultAgentId !== "string"
    ) {
      return null;
    }
    if (Date.parse(parsed.expiresAt) <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredCsrf): void {
  sessionStorage.setItem(CSRF_STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSession(): void {
  sessionStorage.removeItem(CSRF_STORAGE_KEY);
}

let bootstrapInFlight: Promise<SafeSessionClient> | null = null;

async function fetchBootstrap(): Promise<SafeSessionClient> {
  const response = await fetch("/api/session/bootstrap", {
    method: "GET",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`session_bootstrap_failed:${response.status}`);
  }
  const body = (await response.json()) as {
    csrfToken?: string;
    defaultAgentId?: SafeAgentId;
    expiresAt?: string;
  };
  if (!body.csrfToken || !body.defaultAgentId || !body.expiresAt) {
    throw new Error("session_bootstrap_invalid");
  }
  const session: StoredCsrf = {
    csrfToken: body.csrfToken,
    defaultAgentId: body.defaultAgentId,
    expiresAt: body.expiresAt,
  };
  writeStoredSession(session);
  return session;
}

export async function ensureSafeSession(): Promise<SafeSessionClient> {
  const cached = readStoredSession();
  if (cached) {
    return {
      csrfToken: cached.csrfToken,
      defaultAgentId: cached.defaultAgentId,
      expiresAt: cached.expiresAt,
    };
  }
  bootstrapInFlight ??= fetchBootstrap().finally(() => {
    bootstrapInFlight = null;
  });
  return bootstrapInFlight;
}

function toHeaderRecord(init?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!init) return headers;
  if (init instanceof Headers) {
    init.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }
  if (Array.isArray(init)) {
    for (const [key, value] of init) headers[key] = value;
    return headers;
  }
  return { ...init };
}

export async function safeCoreFetch(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  const session = await ensureSafeSession();
  const headers = toHeaderRecord(init.headers);
  headers[CSRF_HEADER_NAME] = session.csrfToken;
  if (init.body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  if (response.status === 401 && retry) {
    clearStoredSession();
    bootstrapInFlight = null;
    return safeCoreFetch(path, init, false);
  }
  return response;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException("The operation was aborted.", "AbortError");
}

function parseSseBlock(block: string): SafeEventEnvelope | null {
  const lines = block.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new SafeProtocolError("malformed_event_json");
  }
  const parsed = eventEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new SafeProtocolError("invalid_event_envelope");
  }
  return parsed.data as SafeEventEnvelope;
}

export async function* parseSafeEventStream(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SafeEventEnvelope, void, undefined> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of chunks) {
    throwIfAborted(signal);
    buffer += decoder.decode(chunk, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const event = parseSseBlock(block.replace(/\r/g, ""));
      if (event) yield event;
      throwIfAborted(signal);
      separator = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const event = parseSseBlock(buffer.replace(/\r/g, ""));
    if (event) yield event;
  }
}

async function* readResponseChunks(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array, void, undefined> {
  if (!response.body) throw new SafeProtocolError("missing_sse_body");
  const reader = response.body.getReader();
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamRunEvents(
  runId: string,
  lastEventId: string | null,
  signal: AbortSignal,
): AsyncGenerator<SafeEventEnvelope, void, undefined> {
  const headers: Record<string, string> = {};
  if (lastEventId) headers["Last-Event-ID"] = lastEventId;
  const response = await safeCoreFetch(
    `/api/runs/${encodeURIComponent(runId)}?stream=1`,
    {
      method: "GET",
      headers: { ...headers, Accept: "text/event-stream" },
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(`sse_http_${response.status}`);
  }
  yield* parseSafeEventStream(readResponseChunks(response, signal), signal);
}
