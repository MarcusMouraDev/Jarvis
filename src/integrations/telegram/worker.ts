import { createHash } from "node:crypto";
import { getCentralWorkspaceStore } from "@/core/central-workspace-runtime";
import { getTelegramStore } from "./runtime";

interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}
interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from?: { id: number };
    text?: string;
    document?: TelegramDocument;
  };
  callback_query?: { id: string; from: { id: number }; data?: string };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function telegramApi<T>(token: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) throw new Error(`telegram_${method}_${response.status}`);
  const payload = (await response.json()) as { ok: boolean; result: T };
  if (!payload.ok) throw new Error(`telegram_${method}_rejected`);
  return payload.result;
}

async function sendText(
  token: string,
  chatId: string,
  text: string,
  approvalId?: string | null,
): Promise<void> {
  const normalized = text.trim() || "Sem resposta.";
  for (let start = 0; start < normalized.length; start += 4_000) {
    const isLast = start + 4_000 >= normalized.length;
    await telegramApi(token, "sendMessage", {
      chat_id: chatId,
      text: normalized.slice(start, start + 4_000),
      ...(approvalId && isLast
        ? {
            reply_markup: {
              inline_keyboard: [[
                { text: "Aprovar uma vez", callback_data: `approve:${approvalId}` },
                { text: "Negar", callback_data: `deny:${approvalId}` },
              ]],
            },
          }
        : {}),
    });
  }
}

async function sendWorkspaceFile(token: string, chatId: string, fileId: string): Promise<void> {
  const workspace = getCentralWorkspaceStore();
  const file = workspace.getFile(fileId);
  if (!file || file.deletedAt) throw new Error("file_not_found");
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set(
    "document",
    new Blob([new Uint8Array(workspace.readFileContent(fileId))], { type: file.mime }),
    file.relativePath.split("/").at(-1) ?? "documento",
  );
  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`telegram_sendDocument_${response.status}`);
}

export function responseText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(responseText).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  if ((row.type === "output_text" || row.type === "text") && typeof row.text === "string") {
    return row.text;
  }
  return responseText(row.output ?? row.content ?? []);
}

export function approvalRunId(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = approvalRunId(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const type = String(row.type ?? row.status ?? "");
  const candidate = row.run_id ?? row.runId;
  if (
    ["approval_required", "awaiting_approval", "requires_action"].includes(type) &&
    typeof candidate === "string" &&
    /^[A-Za-z0-9._:-]{1,48}$/.test(candidate)
  ) {
    return candidate;
  }
  return approvalRunId(row.output ?? row.content ?? row.data ?? []);
}

function hermesHeaders(sessionKey?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(sessionKey ? { "X-Hermes-Session-Key": sessionKey } : {}),
    ...(process.env.HERMES_GATEWAY_API_KEY
      ? { Authorization: `Bearer ${process.env.HERMES_GATEWAY_API_KEY}` }
      : {}),
  };
}

async function askHermes(userId: string, text: string): Promise<{ text: string; approvalId: string | null }> {
  const base = process.env.HERMES_GATEWAY_HTTP ?? "http://127.0.0.1:9119";
  const response = await fetch(`${base.replace(/\/$/, "")}/v1/responses`, {
    method: "POST",
    headers: hermesHeaders(`telegram:${userId}`),
    body: JSON.stringify({ input: text, model: "jarvis-broker", store: true }),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok) throw new Error(`hermes_response_${response.status}`);
  const payload: unknown = await response.json();
  return { text: responseText(payload), approvalId: approvalRunId(payload) };
}

async function importDocument(token: string, document: TelegramDocument) {
  if ((document.file_size ?? 0) > 50 * 1024 * 1024) throw new Error("telegram_file_too_large");
  const remote = await telegramApi<{ file_path: string }>(token, "getFile", {
    file_id: document.file_id,
  });
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${remote.file_path}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`telegram_download_${response.status}`);
  const content = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(content).digest("hex");
  const fileName = document.file_name ?? `telegram-${document.file_id}.bin`;
  const relativePath = `Inbox/${fileName}`;
  const workspace = getCentralWorkspaceStore();
  workspace.createWorkspace({ workspaceId: "jarvis", name: "Jarvis" });
  const existing = workspace.listFiles("jarvis").find((file) => file.relativePath === relativePath);
  const metadata = {
    fileName,
    mime: document.mime_type ?? "application/octet-stream",
    size: content.length,
    sha256,
    origin: "telegram" as const,
  };
  const upload = existing
    ? workspace.createVersionUpload(existing.fileId, existing.version, metadata)
    : workspace.createUpload({ ...metadata, workspaceId: "jarvis", relativePath });
  workspace.putChunk(upload.uploadId, 0, content, sha256);
  return workspace.completeUpload(upload.uploadId);
}

async function handleCallback(token: string, callback: NonNullable<TelegramUpdate["callback_query"]>) {
  const store = getTelegramStore();
  if (!store.claimCallback(callback.id)) return;
  if (!store.getAuthorizedChat(String(callback.from.id))) return;
  const match = /^(approve|deny):([A-Za-z0-9._:-]{1,48})$/.exec(callback.data ?? "");
  if (!match) return;
  const base = process.env.HERMES_GATEWAY_HTTP ?? "http://127.0.0.1:9119";
  const response = await fetch(
    `${base.replace(/\/$/, "")}/v1/runs/${encodeURIComponent(match[2])}/approval`,
    {
      method: "POST",
      headers: hermesHeaders(),
      body: JSON.stringify({ choice: match[1] === "approve" ? "once" : "deny" }),
    },
  );
  await telegramApi(token, "answerCallbackQuery", {
    callback_query_id: callback.id,
    text: response.ok ? "Decisão registrada." : "Aprovação não está mais ativa.",
  });
}

async function handleUpdate(token: string, update: TelegramUpdate): Promise<void> {
  const store = getTelegramStore();
  if (!store.claimUpdate(update.update_id)) return;
  if (update.callback_query) return handleCallback(token, update.callback_query);
  const message = update.message;
  if (!message?.from || message.chat.type !== "private") return;
  const userId = String(message.from.id);
  const chatId = String(message.chat.id);
  const text = message.text?.trim() ?? "";
  if (text.startsWith("/link ")) {
    try {
      store.redeemLinkCode(text.slice(6), { telegramUserId: userId, chatId });
      await sendText(token, chatId, "Telegram vinculado ao Jarvis.");
    } catch {
      await sendText(token, chatId, "Código inválido ou expirado.");
    }
    return;
  }
  const link = store.getAuthorizedChat(userId);
  if (!link || link.chatId !== chatId) {
    await sendText(token, chatId, "Acesso não vinculado. Gere um código no painel Jarvis.");
    return;
  }
  if (text === "/unlink") {
    store.unlink(userId);
    await sendText(token, chatId, "Acesso Telegram revogado.");
  } else if (text === "/files") {
    const files = getCentralWorkspaceStore().listFiles("jarvis");
    const listing = files.length
      ? files.slice(0, 30).map((file) => `${file.fileId} · ${file.relativePath} · v${file.version}`).join("\n")
      : "Nenhum arquivo central.";
    await sendText(token, chatId, listing);
  } else if (text.startsWith("/file ")) {
    await sendWorkspaceFile(token, chatId, text.slice(6).trim());
  } else if (message.document) {
    const file = await importDocument(token, message.document);
    await sendText(token, chatId, `Arquivo disponível no workspace: ${file.relativePath} (v${file.version}).`);
  } else if (text) {
    const answer = await askHermes(userId, text);
    await sendText(token, chatId, answer.text, answer.approvalId);
  }
}

export async function runTelegramWorker(token: string): Promise<never> {
  const store = getTelegramStore();
  for (;;) {
    try {
      const updates = await telegramApi<TelegramUpdate[]>(token, "getUpdates", {
        offset: store.nextUpdateOffset(),
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      });
      for (const update of updates) {
        try {
          await handleUpdate(token, update);
        } catch (error) {
          store.releaseUpdate(update.update_id);
          if (update.callback_query) store.releaseCallback(update.callback_query.id);
          throw error;
        }
      }
    } catch {
      await sleep(2_000);
    }
  }
}
