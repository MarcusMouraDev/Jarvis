#!/usr/bin/env node
/**
 * Fake Hermes gateway: JSON-RPC NDJSON over WebSocket.
 * Holds the turn on approval.request until approval.respond.
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.env.HERMES_FAKE_PORT ?? 9119);
const pendingBySocket = new WeakMap();
let approvalSeq = 0;
let sessionSeq = 0;

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  res.setHeader("content-type", "application/json");
  res.statusCode = 200;
  if (url.startsWith("/api/learning")) {
    res.end(JSON.stringify({ frames: [], graph: { nodes: [] } }));
    return;
  }
  if (url.startsWith("/api/memory")) {
    res.end(JSON.stringify({ memory: "", user: "" }));
    return;
  }
  if (url.startsWith("/api/curator")) {
    res.end(JSON.stringify({ skills: [] }));
    return;
  }
  res.end(JSON.stringify({ ok: true }));
});

const wss = new WebSocketServer({ server });

function send(ws, obj) {
  ws.send(`${JSON.stringify(obj)}\n`);
}

function notify(ws, type, payload, session_id) {
  send(ws, {
    jsonrpc: "2.0",
    method: "event",
    params: { type, payload, session_id },
  });
}

function completeTurn(ws, session_id) {
  notify(ws, "tool.complete", { name: "terminal", ok: true }, session_id);
  notify(ws, "message.complete", { status: "ok", text: "ok **negrito**" }, session_id);
}

wss.on("connection", (ws) => {
  notify(ws, "gateway.ready", { ok: true });
  ws.on("message", (raw) => {
    const line = String(raw).split("\n").find(Boolean);
    if (!line) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const id = parsed.id;
    const method = parsed.method;
    if (method === "session.create") {
      send(ws, { jsonrpc: "2.0", id, result: { session_id: `sess-fake-${++sessionSeq}` } });
      return;
    }
    if (method === "prompt.submit") {
      send(ws, { jsonrpc: "2.0", id, result: { ok: true } });
      const session_id = parsed.params?.session_id ?? "sess-fake";
      const prose = `${"linha de prosa para o orbe colapsar.\n".repeat(24)}ok **negrito**`;
      notify(ws, "message.start", {}, session_id);
      notify(ws, "message.delta", { text: prose }, session_id);
      notify(
        ws,
        "tool.start",
        { tool_id: "t1", name: "terminal", args: { cmd: "ls" } },
        session_id,
      );
      notify(
        ws,
        "approval.request",
        {
          request_id: `apr-${++approvalSeq}`,
          command: "ls",
          pattern_key: "shell",
          description: "list files",
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          choices: ["once", "session", "always", "deny"],
        },
        session_id,
      );
      pendingBySocket.set(ws, session_id);
      return;
    }
    if (method === "approval.respond") {
      send(ws, { jsonrpc: "2.0", id, result: { ok: true } });
      const session_id =
        parsed.params?.session_id ?? pendingBySocket.get(ws) ?? "sess-fake";
      completeTurn(ws, session_id);
      pendingBySocket.delete(ws);
      return;
    }
    if (method === "session.interrupt" || method === "session.abort") {
      send(ws, { jsonrpc: "2.0", id, result: { ok: true } });
      const session_id =
        parsed.params?.session_id ?? pendingBySocket.get(ws) ?? "sess-fake";
      notify(ws, "message.complete", { status: "cancelled" }, session_id);
      pendingBySocket.delete(ws);
      return;
    }
    if (method === "learning.frames") {
      send(ws, { jsonrpc: "2.0", id, result: { frames: [] } });
      return;
    }
    send(ws, { jsonrpc: "2.0", id, result: { ok: true } });
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`hermes-fake-gateway ${port}\n`);
});
