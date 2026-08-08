import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  mkdtempSync,
  mkdirSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAgentCatalogFromDisk } from "./agent-catalog";
import { closeCoreStore, CoreStore, openCoreStore } from "./core-store";
import {
  SafeToolGateway,
  type SafeProcessExecutor,
} from "./tool-gateway";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("safe tool gateway", () => {
  let dataDir: string;
  let projectsRoot: string;
  let workspace: string;
  let store: CoreStore;
  let currentTime: Date;
  let nextId: number;
  let execute: ReturnType<typeof vi.fn<SafeProcessExecutor>>;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "jarvis-safe-tools-data-"));
    projectsRoot = realpathSync(
      mkdtempSync(path.join(tmpdir(), "jarvis-safe-tools-projects-")),
    );
    workspace = path.join(projectsRoot, "workspace");
    mkdirSync(workspace);
    writeFileSync(path.join(workspace, "README.md"), "hello\n");
    writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", release: "curl example" } }),
    );
    process.env.JARVIS_DATA_DIR = dataDir;
    store = openCoreStore();
    store.createSafeSession({
      sessionId: "session-1",
      csrfHash: "a".repeat(64),
      defaultAgentId: "Hermes",
      createdAt: "2026-08-08T10:00:00.000Z",
      lastSeenAt: "2026-08-08T10:00:00.000Z",
      expiresAt: "2026-08-09T10:00:00.000Z",
    });
    store.createRun({
      runId: "run-1",
      sessionId: "session-1",
      agentId: "Hermes",
      privacyClass: "internal",
      requestedModel: "gemini",
      workspace: { kind: "existing", path: workspace },
      status: "running",
      createdAt: "2026-08-08T10:00:00.000Z",
    });
    currentTime = new Date("2026-08-08T10:01:00.000Z");
    nextId = 0;
    execute = vi.fn(async () => ({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    }));
  });

  afterEach(() => {
    closeCoreStore();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(projectsRoot, { recursive: true, force: true });
    delete process.env.JARVIS_DATA_DIR;
  });

  function gateway(overrides: Partial<ConstructorParameters<typeof SafeToolGateway>[0]> = {}) {
    return new SafeToolGateway({
      store,
      catalog: loadAgentCatalogFromDisk(),
      execute,
      clock: () => currentTime,
      randomId: () => `id-${++nextId}`,
      ...overrides,
    });
  }

  async function pendingTerminalRun(input = {
    program: "npm",
    args: ["run", "test"],
    script: "test",
  }) {
    const result = await gateway().invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "terminal.run",
      input,
    });
    expect(result.status).toBe("approval_required");
    if (result.status !== "approval_required") throw new Error("expected approval");
    return { result, input };
  }

  it("auto-executes a bounded read in the frozen workspace", async () => {
    const result = await gateway().invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "code.context",
      input: { paths: ["README.md"] },
    });

    expect(result).toMatchObject({
      status: "completed",
      output: {
        files: [{ path: "README.md", content: "hello\n", sha256: sha256("hello\n") }],
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs structured read commands with shell disabled and a scrubbed environment", async () => {
    const result = await gateway().invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "terminal.read",
      input: { program: "git", args: ["status", "--short"] },
    });

    expect(result.status).toBe("completed");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        program: "git",
        args: ["status", "--short"],
        cwd: workspace,
        shell: false,
        env: expect.not.objectContaining({ HOME: expect.anything() }),
      }),
    );
  });

  it.each([
    { program: "/bin/cat", args: ["README.md"] },
    { program: "cat", args: ["../secret"] },
    { program: "cat", args: [".env"] },
    { program: "wc", args: ["--files0-from=/etc/passwd"] },
    { program: "rg", args: ["x", ">", "out"] },
    { program: "rg", args: ["--pre", "arbitrary-program", "x"] },
    { program: "rg", args: ["--hidden", "TOKEN", "."] },
    { program: "git", args: ["status", "--output=result"] },
    { program: "git", args: ["branch", "new-branch"] },
  ])("denies unsafe structured read input %#", async (input) => {
    await expect(
      gateway().invoke({
        sessionId: "session-1",
        runId: "run-1",
        toolId: "terminal.read",
        input,
      }),
    ).rejects.toThrow("unsafe_terminal_read");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { program: "git", args: ["push"] },
    { program: "git", args: ["reset", "--hard"] },
    { program: "git", args: ["clean", "-fd"] },
    { program: "git", args: ["checkout", "."] },
    { program: "rm", args: ["-rf", "."] },
    { program: "npm", args: ["run", "missing"], script: "missing" },
  ])("denies destructive or non-enumerated run input %#", async (input) => {
    await expect(
      gateway().invoke({
        sessionId: "session-1",
        runId: "run-1",
        toolId: "terminal.run",
        input,
      }),
    ).rejects.toThrow("unsafe_terminal_run");
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns an exact pending approval before any terminal callback", async () => {
    const { result } = await pendingTerminalRun();

    expect(result).toMatchObject({
      status: "approval_required",
      expiresAt: "2026-08-08T10:11:00.000Z",
      preview: { kind: "terminal_run", program: "npm", script: "test" },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(store.getSafeApproval(result.approvalId)).toMatchObject({
      status: "pending",
      sessionId: "session-1",
      runId: "run-1",
      invocationId: result.invocationId,
      toolId: "terminal.run",
      toolVersion: "1.0.0",
    });
    expect(() =>
      store
        .getDatabaseForTests()
        .prepare("UPDATE approvals SET status = 'consumed' WHERE approval_id = ?")
        .run(result.approvalId),
    ).toThrow("invalid_safe_approval_transition");
  });

  it("never lets Planner mutate even if an approval would be possible", async () => {
    store.createRun({
      runId: "planner-run",
      sessionId: "session-1",
      agentId: "Planner",
      privacyClass: "internal",
      requestedModel: "gemini",
      workspace: { kind: "existing", path: workspace },
      status: "running",
    });

    await expect(
      gateway().invoke({
        sessionId: "session-1",
        runId: "planner-run",
        toolId: "file.patch",
        input: {
          diff: "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-hello\n+changed\n",
          preimageHashes: { "README.md": sha256("hello\n") },
        },
      }),
    ).rejects.toThrow("tool_not_allowed");
    expect(readFileSync(path.join(workspace, "README.md"), "utf8")).toBe("hello\n");
  });

  it("approves and consumes once while resuming the same invocation", async () => {
    const { result, input } = await pendingTerminalRun();
    gateway().decideApproval({
      approvalId: result.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });

    const completed = await gateway().resume({
      sessionId: "session-1",
      runId: "run-1",
      invocationId: result.invocationId,
      input,
    });

    expect(completed).toMatchObject({
      status: "completed",
      invocationId: result.invocationId,
      output: { stdout: "ok" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.getSafeApproval(result.approvalId)?.status).toBe("consumed");
    await expect(
      gateway().resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: result.invocationId,
        input,
      }),
    ).rejects.toThrow("approval_not_consumable");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("denies, expires, and rejects session/input/workspace/tool-version mismatches without effects", async () => {
    const denied = await pendingTerminalRun();
    gateway().decideApproval({
      approvalId: denied.result.approvalId,
      sessionId: "session-1",
      decision: "denied",
    });
    await expect(
      gateway().resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: denied.result.invocationId,
        input: denied.input,
      }),
    ).rejects.toThrow("approval_not_consumable");

    const expired = await pendingTerminalRun();
    currentTime = new Date("2026-08-08T10:12:00.000Z");
    expect(
      gateway().decideApproval({
        approvalId: expired.result.approvalId,
        sessionId: "session-1",
        decision: "approved",
      }),
    ).toMatchObject({ status: "expired" });

    currentTime = new Date("2026-08-08T10:02:00.000Z");
    const mismatch = await pendingTerminalRun();
    expect(() =>
      gateway().decideApproval({
        approvalId: mismatch.result.approvalId,
        sessionId: "other-session",
        decision: "approved",
      }),
    ).toThrow("approval_binding_mismatch");
    gateway().decideApproval({
      approvalId: mismatch.result.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });
    await expect(
      gateway().resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: mismatch.result.invocationId,
        input: { ...mismatch.input, script: "release", args: ["run", "release"] },
      }),
    ).rejects.toThrow("approval_binding_mismatch");

    const workspaceMismatch = await pendingTerminalRun();
    gateway().decideApproval({
      approvalId: workspaceMismatch.result.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });
    store.getDatabaseForTests().prepare(
      "UPDATE runs SET workspace_json = ? WHERE run_id = 'run-1'",
    ).run(JSON.stringify({ kind: "existing", path: projectsRoot }));
    await expect(
      gateway().resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: workspaceMismatch.result.invocationId,
        input: workspaceMismatch.input,
      }),
    ).rejects.toThrow("approval_binding_mismatch");
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed when persisted tool version or described effect is altered", async () => {
    const version = await pendingTerminalRun();
    gateway().decideApproval({
      approvalId: version.result.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });
    store.getDatabaseForTests().prepare(
      "UPDATE tool_invocations SET tool_version = '9.0.0' WHERE invocation_id = ?",
    ).run(version.result.invocationId);
    await expect(
      gateway().resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: version.result.invocationId,
        input: version.input,
      }),
    ).rejects.toThrow("approval_binding_mismatch");

    const effect = await pendingTerminalRun();
    gateway().decideApproval({
      approvalId: effect.result.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });
    store.getDatabaseForTests().prepare(
      "UPDATE tool_invocations SET effect_json = '{\"kind\":\"altered\"}' WHERE invocation_id = ?",
    ).run(effect.result.invocationId);
    await expect(
      gateway().resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: effect.result.invocationId,
        input: effect.input,
      }),
    ).rejects.toThrow("approval_binding_mismatch");
    expect(execute).not.toHaveBeenCalled();
  });

  it("binds approval to the exact package script definition", async () => {
    const pending = await pendingTerminalRun();
    gateway().decideApproval({
      approvalId: pending.result.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });
    writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({ scripts: { test: "different command" } }),
    );

    await expect(
      gateway().resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: pending.result.invocationId,
        input: pending.input,
      }),
    ).rejects.toThrow("approval_binding_mismatch");
    expect(execute).not.toHaveBeenCalled();
  });

  it("consumes an approval transactionally across two database handles", async () => {
    const { result, input } = await pendingTerminalRun();
    gateway().decideApproval({
      approvalId: result.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });
    const secondDatabase = new Database(path.join(dataDir, "core.db"));
    secondDatabase.pragma("busy_timeout = 5000");
    secondDatabase.pragma("foreign_keys = ON");
    const secondStore = new CoreStore(secondDatabase);
    const secondGateway = gateway({ store: secondStore });

    const attempts = await Promise.allSettled([
      gateway().resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: result.invocationId,
        input,
      }),
      secondGateway.resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: result.invocationId,
        input,
      }),
    ]);
    secondStore.close();

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("marks a possibly-started side effect unknown and never retries it", async () => {
    execute.mockRejectedValueOnce(Object.assign(new Error("lost process"), { effectStarted: true }));
    const { result, input } = await pendingTerminalRun();
    gateway().decideApproval({
      approvalId: result.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });

    await expect(
      gateway().resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: result.invocationId,
        input,
      }),
    ).rejects.toThrow("effect_outcome_unknown");
    expect(store.getSafeInvocation(result.invocationId)?.status).toBe("unknown");
    await expect(
      gateway().resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: result.invocationId,
        input,
      }),
    ).rejects.toThrow("approval_not_consumable");
    expect(execute).toHaveBeenCalledTimes(1);

    const blocked = await pendingTerminalRun();
    gateway().decideApproval({
      approvalId: blocked.result.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });
    await expect(
      gateway().resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: blocked.result.invocationId,
        input: blocked.input,
      }),
    ).rejects.toThrow("side_effect_already_active");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("previews and atomically applies an exact hash-bound patch only after approval", async () => {
    const input = {
      diff: "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-hello\n+changed\n",
      preimageHashes: { "README.md": sha256("hello\n") },
    };
    const pending = await gateway().invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "file.patch",
      input,
    });
    expect(pending).toMatchObject({
      status: "approval_required",
      preview: { kind: "file_patch", paths: ["README.md"], diff: input.diff },
    });
    expect(readFileSync(path.join(workspace, "README.md"), "utf8")).toBe("hello\n");
    if (pending.status !== "approval_required") throw new Error("expected approval");
    gateway().decideApproval({
      approvalId: pending.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });
    const applied = await gateway().resume({
      sessionId: "session-1",
      runId: "run-1",
      invocationId: pending.invocationId,
      input,
    });

    expect(applied).toMatchObject({ status: "completed", output: { applied: true } });
    expect(readFileSync(path.join(workspace, "README.md"), "utf8")).toBe("changed\n");
  });

  it("rejects patch traversal, sensitive paths, symlinks, and stale hashes without partial effects", async () => {
    symlinkSync(projectsRoot, path.join(workspace, "linked"));
    for (const input of [
      {
        diff: "--- a/../outside\n+++ b/../outside\n@@ -0,0 +1 @@\n+x\n",
        preimageHashes: { "../outside": sha256("") },
      },
      {
        diff: "--- a/.env\n+++ b/.env\n@@ -0,0 +1 @@\n+TOKEN=x\n",
        preimageHashes: { ".env": sha256("") },
      },
      {
        diff: "--- a/linked/new\n+++ b/linked/new\n@@ -0,0 +1 @@\n+x\n",
        preimageHashes: { "linked/new": sha256("") },
      },
    ]) {
      await expect(
        gateway().invoke({
          sessionId: "session-1",
          runId: "run-1",
          toolId: "file.patch",
          input,
        }),
      ).rejects.toThrow("unsafe_patch");
    }

    const stale = {
      diff: "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-hello\n+changed\n",
      preimageHashes: { "README.md": sha256("stale\n") },
    };
    const pending = await gateway().invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "file.patch",
      input: stale,
    });
    if (pending.status !== "approval_required") throw new Error("expected approval");
    gateway().decideApproval({
      approvalId: pending.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });
    await expect(
      gateway().resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: pending.invocationId,
        input: stale,
      }),
    ).rejects.toThrow("preimage_hash_mismatch");
    expect(readFileSync(path.join(workspace, "README.md"), "utf8")).toBe("hello\n");
  });

  it("revalidates preimage hashes immediately before applying", async () => {
    let raced = false;
    const injectedFileSystem = {
      readFile: (filePath: string) => readFileSync(filePath),
      lstat: (filePath: string) => lstatSync(filePath),
      mkdir: (directoryPath: string, options?: { recursive?: boolean }) =>
        mkdirSync(directoryPath, options),
      writeFile: (filePath: string, value: string, options?: { flag?: string }) => {
        writeFileSync(filePath, value, options);
        if (!raced && path.basename(filePath).startsWith(".jarvis-patch-")) {
          raced = true;
          writeFileSync(path.join(workspace, "README.md"), "raced\n");
        }
      },
      rename: (from: string, to: string) => renameSync(from, to),
      unlink: (filePath: string) => unlinkSync(filePath),
    };
    const exactInput = {
      diff: "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-hello\n+changed\n",
      preimageHashes: { "README.md": sha256("hello\n") },
    };
    const exactGateway = gateway({ fileSystem: injectedFileSystem });
    const pending = await exactGateway.invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "file.patch",
      input: exactInput,
    });
    if (pending.status !== "approval_required") throw new Error("expected approval");
    exactGateway.decideApproval({
      approvalId: pending.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });

    await expect(
      exactGateway.resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: pending.invocationId,
        input: exactInput,
      }),
    ).rejects.toThrow("preimage_hash_mismatch");
    expect(readFileSync(path.join(workspace, "README.md"), "utf8")).toBe("raced\n");
  });

  it("creates only the exact nonexistent Builder child after approval", async () => {
    store.createRun({
      runId: "builder-run",
      sessionId: "session-1",
      agentId: "Builder",
      privacyClass: "internal",
      requestedModel: "gemini",
      workspace: { kind: "new", name: "new-app", path: path.join(projectsRoot, "new-app") },
      status: "running",
    });
    const pending = await gateway().invoke({
      sessionId: "session-1",
      runId: "builder-run",
      toolId: "project.create",
      input: { name: "new-app" },
    });
    expect(() => readFileSync(path.join(projectsRoot, "new-app"))).toThrow();
    if (pending.status !== "approval_required") throw new Error("expected approval");
    gateway().decideApproval({
      approvalId: pending.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });
    const created = await gateway().resume({
      sessionId: "session-1",
      runId: "builder-run",
      invocationId: pending.invocationId,
      input: { name: "new-app" },
    });

    expect(created).toMatchObject({ status: "completed", output: { created: true } });
    expect(realpathSync(path.join(projectsRoot, "new-app"))).toBe(
      path.join(projectsRoot, "new-app"),
    );
    await expect(
      gateway().invoke({
        sessionId: "session-1",
        runId: "builder-run",
        toolId: "project.create",
        input: { name: "new-app" },
      }),
    ).rejects.toThrow("project_already_exists");
    await expect(
      gateway().invoke({
        sessionId: "session-1",
        runId: "builder-run",
        toolId: "project.create",
        input: { name: "../elsewhere" },
      }),
    ).rejects.toThrow();
  });

  it("validates, redacts, and caps stored executor output", async () => {
    execute.mockResolvedValueOnce({
      exitCode: 0,
      stdout: `token=super-secret ${"x".repeat(300_000)}`,
      stderr: "",
      timedOut: false,
    });
    const pending = await gateway().invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "terminal.read",
      input: { program: "pwd", args: [] },
    });

    expect(pending.status).toBe("completed");
    const persisted = store.getSafeInvocation(pending.invocationId);
    expect(JSON.stringify(persisted?.output)).not.toContain("super-secret");
    expect(Buffer.byteLength(JSON.stringify(persisted?.output))).toBeLessThan(210_000);
  });

  it("rejects executor output that does not match the manifest schema", async () => {
    execute.mockResolvedValueOnce({ exitCode: 0, stdout: "bad" } as never);

    await expect(
      gateway().invoke({
        sessionId: "session-1",
        runId: "run-1",
        toolId: "terminal.read",
        input: { program: "pwd", args: [] },
      }),
    ).rejects.toThrow();
    expect(
      store
        .getDatabaseForTests()
        .prepare("SELECT status FROM tool_invocations ORDER BY created_at DESC LIMIT 1")
        .get(),
    ).toMatchObject({ status: "failed" });
  });
});
