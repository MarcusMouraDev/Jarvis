import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompanionStore } from "./companion-store";

describe("CompanionStore", () => {
  let root: string;
  let store: CompanionStore;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jarvis-companion-"));
    store = new CompanionStore(root);
  });

  afterEach(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("pairs once, authenticates by hashed token and revokes immediately", () => {
    const code = store.createPairingCode("marcus@example.com");
    const paired = store.redeemPairingCode(code.code, {
      label: "MacBook",
      capabilities: ["files.read", "files.upload", "desktop_ui"],
    });

    expect(paired.token).toMatch(/^jcp_/);
    expect(store.authenticate(paired.token)?.deviceId).toBe(paired.device.deviceId);
    expect(() => store.redeemPairingCode(code.code, { label: "outro", capabilities: [] })).toThrow(
      "pairing_code_invalid",
    );

    store.revokeDevice(paired.device.deviceId);
    expect(store.authenticate(paired.token)).toBeNull();
  });

  it("does not let another Tailscale identity redeem the code", () => {
    const code = store.createPairingCode("marcus@example.com");
    expect(() =>
      store.redeemPairingCode(
        code.code,
        { label: "MacBook", capabilities: ["files.read"] },
        "intruso@example.com",
      ),
    ).toThrow("pairing_identity_mismatch");
  });

  it("stores opaque grants and only dispatches supported capability jobs", () => {
    const paired = store.redeemPairingCode(store.createPairingCode("m@example.com").code, {
      label: "Mac",
      capabilities: ["files.read"],
    });
    store.heartbeat(paired.token, ["files.read"]);
    const grant = store.upsertGrant(paired.token, {
      grantId: "documents",
      label: "Documentos",
      access: "read",
    });
    expect(grant).not.toHaveProperty("path");

    expect(() =>
      store.createJob({
        deviceId: paired.device.deviceId,
        capability: "desktop_ui",
        payload: {},
        idempotencyKey: "unsupported",
      }),
    ).toThrow("companion_capability_unavailable");

    const job = store.createJob({
      deviceId: paired.device.deviceId,
      capability: "files.read",
      payload: { grantId: "documents", relativePath: "relatorio.txt" },
      idempotencyKey: "read-1",
    });
    expect(job.nonce).toMatch(/^[a-f0-9-]{36}$/);
    expect(store.pollJobs(paired.token)).toHaveLength(1);
  });

  it("accepts retry of identical result but rejects a conflicting result", () => {
    const paired = store.redeemPairingCode(store.createPairingCode("m@example.com").code, {
      label: "Mac",
      capabilities: ["files.read"],
    });
    const job = store.createJob({
      deviceId: paired.device.deviceId,
      capability: "files.read",
      payload: { grantId: "docs", relativePath: "a.txt" },
      idempotencyKey: "same-job",
    });
    expect(store.completeJob(paired.token, job.jobId, job.nonce, { ok: true }).duplicate).toBe(false);
    expect(store.completeJob(paired.token, job.jobId, job.nonce, { ok: true }).duplicate).toBe(true);
    expect(() =>
      store.completeJob(paired.token, job.jobId, job.nonce, { ok: false }),
    ).toThrow("job_result_conflict");
  });

  it("requires explicit approval for local automation", () => {
    const paired = store.redeemPairingCode(store.createPairingCode("m@example.com").code, {
      label: "Mac",
      capabilities: ["automation"],
    });
    expect(() =>
      store.createJob({
        deviceId: paired.device.deviceId,
        capability: "automation",
        payload: { command: "open-window" },
        idempotencyKey: "automation-1",
      }),
    ).toThrow("companion_approval_required");
  });
});
