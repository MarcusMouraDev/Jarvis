import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { configureSqliteConnection } from "@/core/sqlite-connection";

export interface TelegramLink {
  telegramUserId: string;
  chatId: string;
  identityLogin: string;
  linkedAt: string;
}

const now = () => new Date().toISOString();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function mapLink(row: unknown): TelegramLink {
  const value = row as Record<string, string>;
  return {
    telegramUserId: value.telegram_user_id,
    chatId: value.chat_id,
    identityLogin: value.identity_login,
    linkedAt: value.linked_at,
  };
}

export class TelegramStore {
  private readonly database: Database.Database;

  constructor(root: string) {
    mkdirSync(root, { recursive: true });
    this.database = new Database(path.join(root, "telegram.sqlite"));
    configureSqliteConnection(this.database);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS telegram_link_codes (
        code_hash TEXT PRIMARY KEY, identity_login TEXT NOT NULL,
        expires_at TEXT NOT NULL, consumed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS telegram_links (
        telegram_user_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL UNIQUE,
        identity_login TEXT NOT NULL, linked_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS telegram_updates (
        update_id INTEGER PRIMARY KEY, processed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS telegram_callbacks (
        callback_id TEXT PRIMARY KEY, processed_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.database.close();
  }

  createLinkCode(identityLogin: string): { code: string; expiresAt: string } {
    const identity = identityLogin.trim().toLowerCase();
    if (!identity || identity.length > 320) throw new Error("invalid_identity_login");
    const code = randomBytes(5).toString("base64url").toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    this.database
      .prepare("INSERT INTO telegram_link_codes(code_hash, identity_login, expires_at) VALUES (?, ?, ?)")
      .run(hash(code), identity, expiresAt);
    return { code, expiresAt };
  }

  redeemLinkCode(
    code: string,
    input: { telegramUserId: string; chatId: string },
  ): TelegramLink {
    const digest = hash(code.trim().toUpperCase());
    const row = this.database.prepare(
      "SELECT identity_login FROM telegram_link_codes WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?",
    ).get(digest, now()) as { identity_login: string } | undefined;
    if (!row) throw new Error("telegram_link_code_invalid");
    const timestamp = now();
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO telegram_links(telegram_user_id, chat_id, identity_login, linked_at, revoked_at)
        VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(telegram_user_id) DO UPDATE SET chat_id = excluded.chat_id,
          identity_login = excluded.identity_login, linked_at = excluded.linked_at, revoked_at = NULL
      `).run(input.telegramUserId, input.chatId, row.identity_login, timestamp);
      this.database
        .prepare("UPDATE telegram_link_codes SET consumed_at = ? WHERE code_hash = ?")
        .run(timestamp, digest);
    })();
    return this.getAuthorizedChat(input.telegramUserId)!;
  }

  getAuthorizedChat(telegramUserId: string): TelegramLink | null {
    const row = this.database
      .prepare("SELECT * FROM telegram_links WHERE telegram_user_id = ? AND revoked_at IS NULL")
      .get(telegramUserId);
    return row ? mapLink(row) : null;
  }

  unlink(telegramUserId: string): void {
    this.database
      .prepare("UPDATE telegram_links SET revoked_at = ? WHERE telegram_user_id = ?")
      .run(now(), telegramUserId);
  }

  claimUpdate(updateId: number): boolean {
    return Boolean(
      this.database
        .prepare("INSERT OR IGNORE INTO telegram_updates(update_id, processed_at) VALUES (?, ?)")
        .run(updateId, now()).changes,
    );
  }

  releaseUpdate(updateId: number): void {
    this.database.prepare("DELETE FROM telegram_updates WHERE update_id = ?").run(updateId);
  }

  claimCallback(callbackId: string): boolean {
    return Boolean(
      this.database
        .prepare("INSERT OR IGNORE INTO telegram_callbacks(callback_id, processed_at) VALUES (?, ?)")
        .run(callbackId, now()).changes,
    );
  }

  releaseCallback(callbackId: string): void {
    this.database.prepare("DELETE FROM telegram_callbacks WHERE callback_id = ?").run(callbackId);
  }

  nextUpdateOffset(): number {
    const row = this.database.prepare("SELECT MAX(update_id) AS value FROM telegram_updates").get() as {
      value: number | null;
    };
    return (row.value ?? -1) + 1;
  }
}
