import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { configureSqliteConnection } from "./sqlite-connection";

export const COMPANION_CAPABILITIES = [
  "files.list",
  "files.read",
  "files.upload",
  "microphone",
  "desktop_ui",
  "notifications",
  "automation",
] as const;
export type CompanionCapability = (typeof COMPANION_CAPABILITIES)[number];

export interface CompanionDevice {
  deviceId: string;
  identityLogin: string;
  label: string;
  capabilities: CompanionCapability[];
  status: "active" | "revoked";
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface CompanionJob {
  jobId: string;
  deviceId: string;
  capability: CompanionCapability;
  nonce: string;
  payload: unknown;
  status: "pending" | "completed" | "expired";
  expiresAt: string;
}

const now = () => new Date().toISOString();
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function capabilities(value: readonly string[]): CompanionCapability[] {
  const unique = [...new Set(value)];
  if (unique.some((item) => !COMPANION_CAPABILITIES.includes(item as CompanionCapability))) {
    throw new Error("invalid_companion_capability");
  }
  return unique as CompanionCapability[];
}

function mapDevice(row: unknown): CompanionDevice {
  const value = row as Record<string, string | null>;
  return {
    deviceId: String(value.device_id),
    identityLogin: String(value.identity_login),
    label: String(value.label),
    capabilities: JSON.parse(String(value.capabilities_json)) as CompanionCapability[],
    status: value.status as CompanionDevice["status"],
    createdAt: String(value.created_at),
    lastSeenAt: String(value.last_seen_at),
    revokedAt: value.revoked_at,
  };
}

function mapJob(row: unknown): CompanionJob {
  const value = row as Record<string, string>;
  return {
    jobId: value.job_id,
    deviceId: value.device_id,
    capability: value.capability as CompanionCapability,
    nonce: value.nonce,
    payload: JSON.parse(value.payload_json),
    status: value.status as CompanionJob["status"],
    expiresAt: value.expires_at,
  };
}

export class CompanionStore {
  private readonly database: Database.Database;

  constructor(root: string) {
    mkdirSync(root, { recursive: true });
    this.database = new Database(path.join(root, "companions.sqlite"));
    configureSqliteConnection(this.database);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pairing_codes (
        code_hash TEXT PRIMARY KEY, identity_login TEXT NOT NULL,
        expires_at TEXT NOT NULL, consumed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS companion_devices (
        device_id TEXT PRIMARY KEY, identity_login TEXT NOT NULL, label TEXT NOT NULL,
        capabilities_json TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS companion_grants (
        device_id TEXT NOT NULL REFERENCES companion_devices(device_id),
        grant_id TEXT NOT NULL, label TEXT NOT NULL, access TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY(device_id, grant_id)
      );
      CREATE TABLE IF NOT EXISTS companion_jobs (
        job_id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES companion_devices(device_id),
        capability TEXT NOT NULL, nonce TEXT NOT NULL, payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, completed_at TEXT,
        UNIQUE(device_id, idempotency_key)
      );
    `);
  }

  close(): void {
    this.database.close();
  }

  createPairingCode(identityLogin: string): { code: string; expiresAt: string } {
    const identity = identityLogin.trim().toLowerCase();
    if (!identity || identity.length > 320) throw new Error("invalid_identity_login");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    this.database
      .prepare("INSERT INTO pairing_codes(code_hash, identity_login, expires_at) VALUES (?, ?, ?)")
      .run(tokenHash(code), identity, expiresAt);
    return { code, expiresAt };
  }

  redeemPairingCode(
    code: string,
    input: { label: string; capabilities: readonly string[] },
    expectedIdentityLogin?: string,
  ): { token: string; device: CompanionDevice } {
    const digest = tokenHash(code.trim());
    const row = this.database.prepare(
      "SELECT * FROM pairing_codes WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?",
    ).get(digest, now()) as { identity_login: string } | undefined;
    if (!row) throw new Error("pairing_code_invalid");
    if (
      expectedIdentityLogin &&
      row.identity_login !== expectedIdentityLogin.trim().toLowerCase()
    ) {
      throw new Error("pairing_identity_mismatch");
    }
    const label = input.label.trim();
    if (!label || label.length > 128) throw new Error("invalid_device_label");
    const allowed = capabilities(input.capabilities);
    const token = `jcp_${randomBytes(32).toString("base64url")}`;
    const deviceId = randomUUID();
    const timestamp = now();
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO companion_devices(
          device_id, identity_login, label, capabilities_json, token_hash,
          status, created_at, last_seen_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL)
      `).run(deviceId, row.identity_login, label, JSON.stringify(allowed), tokenHash(token), timestamp, timestamp);
      this.database
        .prepare("UPDATE pairing_codes SET consumed_at = ? WHERE code_hash = ?")
        .run(timestamp, digest);
    })();
    return { token, device: this.getDevice(deviceId)! };
  }

  authenticate(token: string): CompanionDevice | null {
    const row = this.database
      .prepare("SELECT * FROM companion_devices WHERE token_hash = ? AND status = 'active'")
      .get(tokenHash(token));
    return row ? mapDevice(row) : null;
  }

  getDevice(deviceId: string): CompanionDevice | null {
    const row = this.database.prepare("SELECT * FROM companion_devices WHERE device_id = ?").get(deviceId);
    return row ? mapDevice(row) : null;
  }

  listDevices(identityLogin: string): CompanionDevice[] {
    return this.database
      .prepare("SELECT * FROM companion_devices WHERE identity_login = ? ORDER BY created_at DESC")
      .all(identityLogin.trim().toLowerCase())
      .map(mapDevice);
  }

  revokeDevice(deviceId: string): CompanionDevice {
    const timestamp = now();
    const result = this.database
      .prepare("UPDATE companion_devices SET status = 'revoked', revoked_at = ? WHERE device_id = ?")
      .run(timestamp, deviceId);
    if (!result.changes) throw new Error("companion_not_found");
    return this.getDevice(deviceId)!;
  }

  heartbeat(token: string, advertised: readonly string[]): CompanionDevice {
    const device = this.authenticate(token);
    if (!device) throw new Error("companion_unauthorized");
    const next = capabilities(advertised);
    if (next.some((item) => !device.capabilities.includes(item))) {
      throw new Error("companion_capability_escalation");
    }
    this.database
      .prepare("UPDATE companion_devices SET capabilities_json = ?, last_seen_at = ? WHERE device_id = ?")
      .run(JSON.stringify(next), now(), device.deviceId);
    return this.getDevice(device.deviceId)!;
  }

  upsertGrant(
    token: string,
    input: { grantId: string; label: string; access: "read" | "read-write" },
  ): { grantId: string; label: string; access: "read" | "read-write" } {
    const device = this.authenticate(token);
    if (!device) throw new Error("companion_unauthorized");
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.grantId)) throw new Error("invalid_grant_id");
    const label = input.label.trim();
    if (!label || label.length > 128) throw new Error("invalid_grant_label");
    this.database.prepare(`
      INSERT INTO companion_grants(device_id, grant_id, label, access, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id, grant_id) DO UPDATE SET label = excluded.label,
        access = excluded.access, updated_at = excluded.updated_at
    `).run(device.deviceId, input.grantId, label, input.access, now());
    return { grantId: input.grantId, label, access: input.access };
  }

  createJob(input: {
    deviceId: string;
    capability: CompanionCapability;
    payload: unknown;
    idempotencyKey: string;
    ttlSeconds?: number;
  }): CompanionJob {
    const device = this.getDevice(input.deviceId);
    if (!device || device.status !== "active") throw new Error("companion_unavailable");
    if (!device.capabilities.includes(input.capability)) {
      throw new Error("companion_capability_unavailable");
    }
    if (
      input.capability === "automation" &&
      (!input.payload || typeof input.payload !== "object" ||
        (input.payload as Record<string, unknown>).approved !== true)
    ) {
      throw new Error("companion_approval_required");
    }
    const existing = this.database
      .prepare("SELECT * FROM companion_jobs WHERE device_id = ? AND idempotency_key = ?")
      .get(input.deviceId, input.idempotencyKey);
    if (existing) return mapJob(existing);
    const jobId = randomUUID();
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + (input.ttlSeconds ?? 300) * 1000).toISOString();
    this.database.prepare(`
      INSERT INTO companion_jobs(
        job_id, device_id, capability, nonce, payload_json, idempotency_key,
        status, result_json, created_at, expires_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL)
    `).run(
      jobId,
      input.deviceId,
      input.capability,
      nonce,
      stable(input.payload),
      input.idempotencyKey,
      now(),
      expiresAt,
    );
    return mapJob(this.database.prepare("SELECT * FROM companion_jobs WHERE job_id = ?").get(jobId));
  }

  pollJobs(token: string): CompanionJob[] {
    const device = this.authenticate(token);
    if (!device) throw new Error("companion_unauthorized");
    this.database
      .prepare("UPDATE companion_jobs SET status = 'expired' WHERE device_id = ? AND status = 'pending' AND expires_at <= ?")
      .run(device.deviceId, now());
    return this.database
      .prepare("SELECT * FROM companion_jobs WHERE device_id = ? AND status = 'pending' ORDER BY created_at")
      .all(device.deviceId)
      .map(mapJob);
  }

  completeJob(
    token: string,
    jobId: string,
    nonce: string,
    result: unknown,
  ): { duplicate: boolean } {
    const device = this.authenticate(token);
    if (!device) throw new Error("companion_unauthorized");
    const row = this.database
      .prepare("SELECT * FROM companion_jobs WHERE job_id = ? AND device_id = ?")
      .get(jobId, device.deviceId) as Record<string, string | null> | undefined;
    if (!row || row.nonce !== nonce) throw new Error("job_not_found");
    const resultJson = stable(result);
    if (row.status === "completed") {
      if (row.result_json !== resultJson) throw new Error("job_result_conflict");
      return { duplicate: true };
    }
    if (row.status !== "pending" || String(row.expires_at) <= now()) throw new Error("job_expired");
    this.database.prepare(
      "UPDATE companion_jobs SET status = 'completed', result_json = ?, completed_at = ? WHERE job_id = ?",
    ).run(resultJson, now(), jobId);
    return { duplicate: false };
  }
}
