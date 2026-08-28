import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCentralWorkspaceStoreForTests } from "./central-workspace-runtime";
import { getCompanionStore, resetCompanionStoreForTests } from "./companion-runtime";
import { requireWorkspaceRequest } from "./central-workspace-route";

describe("workspace companion authorization", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jarvis-workspace-auth-"));
    vi.stubEnv("JARVIS_DATA_DIR", root);
  });

  afterEach(() => {
    resetCentralWorkspaceStoreForTests();
    resetCompanionStoreForTests();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("grants only the endpoint capability advertised during pairing", () => {
    const companions = getCompanionStore();
    const paired = companions.redeemPairingCode(companions.createPairingCode("m@example.com").code, {
      label: "Mac",
      capabilities: ["files.upload"],
    });
    const request = new Request("http://localhost/api/workspaces/jarvis/uploads", {
      headers: { authorization: `Bearer ${paired.token}` },
    });
    expect(requireWorkspaceRequest(request, "files.upload").ok).toBe(true);
    expect(requireWorkspaceRequest(request, "files.read").ok).toBe(false);
    expect(requireWorkspaceRequest(request).ok).toBe(false);
  });
});
