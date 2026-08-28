import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readHermesToken } from "./health";
import { asRecord } from "@/lib/value-guards";

export type HermesRpcEvent = {
  type?: string;
  payload?: unknown;
  params?: unknown;
  session_id?: unknown;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function resolveHermesGatewayUrl(): string {
  const fromEnv = env("HERMES_GATEWAY_URL") || env("HERMES_E2E_GATEWAY_URL");
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "test") {
    try {
      const file = join(process.cwd(), ".jarvis", "e2e-hermes-url");
      if (existsSync(file)) {
        const url = readFileSync(file, "utf8").trim();
        if (url) return url;
      }
    } catch {
      // ignore missing override
    }
  }
  return "ws://127.0.0.1:9119/api/ws";
}

function isReadyType(type: string | undefined): boolean {
  return type === "gateway.ready" || type === "gateway.ready";
}

export class HermesGatewayClient {
  private socket: WebSocket | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(event: HermesRpcEvent) => void>();
  private readyWaiters: Array<() => void> = [];
  private connecting: Promise<void> | null = null;
  ready = false;

  private token: string;

  constructor(
    private url?: string,
    token = env("HERMES_GATEWAY_TOKEN") || env("HERMES_DASHBOARD_SESSION_TOKEN"),
  ) {
    this.token = token;
  }

  onEvent(listener: (event: HermesRpcEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(timeoutMs = 8_000): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN && this.ready) return;
    if (this.connecting) {
      await this.connecting;
      if (this.socket?.readyState === WebSocket.OPEN && this.ready) return;
    }
    this.connecting = this.openSocket(timeoutMs).finally(() => {
      this.connecting = null;
    });
    await this.connecting;
  }

  private async openSocket(timeoutMs: number): Promise<void> {
    this.socket?.close();
    this.socket = null;
    this.ready = false;
    if (!this.token) this.token = await readHermesToken();
    const target = new URL(this.url || resolveHermesGatewayUrl());
    if (this.token && !target.searchParams.has("token")) {
      target.searchParams.set("token", this.token);
    }
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(target.toString());
      this.socket = socket;
      const timer = setTimeout(() => {
        reject(new Error("hermes_gateway_timeout"));
        socket.close();
      }, timeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener("error", () => {
        if (this.socket !== socket) return;
        clearTimeout(timer);
        reject(new Error("hermes_gateway_error"));
      });
      socket.addEventListener("message", (event) => {
        const text = String(event.data);
        this.pushChunk(text.endsWith("\n") ? text : `${text}\n`);
      });
      socket.addEventListener("close", () => {
        if (this.socket !== socket) return;
        this.ready = false;
        this.socket = null;
        for (const waiter of this.pending.values()) {
          waiter.reject(new Error("hermes_gateway_closed"));
        }
        this.pending.clear();
      });
    });
    await this.waitUntilReady(timeoutMs);
  }

  private waitUntilReady(timeoutMs: number): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("hermes_ready_timeout")), timeoutMs);
      this.readyWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
      if (this.ready) {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  async request<T>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 8_000,
  ): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      await this.connect();
    }
    const id = String(this.nextId++);
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("hermes_rpc_timeout"));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.socket!.send(frame);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("hermes_rpc_send"));
      }
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.ready = false;
  }

  private pushChunk(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const record = asRecord(parsed);
    if (!record) return;
    const id = record.id;
    if (id !== undefined && id !== null && this.pending.has(String(id))) {
      const waiter = this.pending.get(String(id))!;
      this.pending.delete(String(id));
      if (record.error) {
        const error = asRecord(record.error);
        waiter.reject(new Error(String(error?.message ?? "hermes_rpc_error")));
        return;
      }
      waiter.resolve(record.result);
      return;
    }
    const method = typeof record.method === "string" ? record.method : "";
    const params = asRecord(record.params) ?? {};
    const event: HermesRpcEvent =
      method === "event"
        ? {
            type: typeof params.type === "string" ? params.type : undefined,
            payload: params.payload ?? params,
            session_id: params.session_id,
          }
        : {
            type: method || (typeof params.type === "string" ? params.type : undefined),
            payload: Object.keys(params).length ? params : record.payload,
            session_id: params.session_id ?? record.session_id,
          };
    if (isReadyType(event.type)) {
      this.ready = true;
      const waiters = this.readyWaiters;
      this.readyWaiters = [];
      for (const waiter of waiters) waiter();
    }
    for (const listener of this.listeners) listener(event);
  }
}
