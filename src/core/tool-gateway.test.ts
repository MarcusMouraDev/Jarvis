import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  chmodSync,
  existsSync,
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
  type SafeToolFileSystem,
} from "./tool-gateway";

const sha256 = (value: string | Buffer) =>
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
    { program: "rg", args: ["-L", "TOKEN", "."] },
    { program: "rg", args: ["--follow", "TOKEN", "."] },
    { program: "rg", args: ["-f", "patterns.txt", "."] },
    { program: "rg", args: ["--file=patterns.txt", "."] },
    { program: "rg", args: ["--ignore-file", "ignore.txt", "TOKEN", "."] },
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
    { program: "ls", args: ["linked-secret"] },
    { program: "cat", args: ["linked-secret"] },
    { program: "head", args: ["linked-secret"] },
    { program: "tail", args: ["linked-secret"] },
    { program: "wc", args: ["linked-secret"] },
    { program: "rg", args: ["outside-secret", "linked-secret"] },
  ])("rejects $program file operands that are workspace symlinks", async (input) => {
    const secret = "outside-secret-contents";
    const outsidePath = path.join(projectsRoot, "outside-secret.txt");
    writeFileSync(outsidePath, secret);
    symlinkSync(outsidePath, path.join(workspace, "linked-secret"));

    await expect(
      gateway({ execute: undefined }).invoke({
        sessionId: "session-1",
        runId: "run-1",
        toolId: "terminal.read",
        input,
      }),
    ).rejects.toThrow("unsafe_terminal_read");
    const persisted = store
      .getDatabaseForTests()
      .prepare("SELECT output_json FROM tool_invocations")
      .all();
    expect(JSON.stringify(persisted)).not.toContain(secret);
  });

  it.each([
    { label: "ls", input: { program: "ls", args: ["note.txt"] } },
    { label: "head", input: { program: "head", args: ["note.txt", "other.txt"] } },
    { label: "tail", input: { program: "tail", args: ["note.txt", "other.txt"] } },
    { label: "wc", input: { program: "wc", args: ["note.txt"] } },
    {
      label: "rg text",
      input: { program: "rg", args: ["hello", "note.txt", "other.txt"] },
    },
    {
      label: "rg JSON",
      input: { program: "rg", args: ["--json", "hello", "note.txt", "other.txt"] },
    },
  ])("normalizes workspace paths in $label output before persistence", async ({ input }) => {
    writeFileSync(path.join(workspace, "note.txt"), "hello note\n");
    writeFileSync(path.join(workspace, "other.txt"), "hello other\n");

    const result = await gateway({ execute: undefined }).invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "terminal.read",
      input,
    });
    if (result.status !== "completed") throw new Error("expected completion");
    const returned = JSON.stringify(result.output);
    const persisted = JSON.stringify(store.getSafeInvocation(result.invocationId)?.output);
    const tempPrefix = realpathSync(tmpdir());

    expect(returned).toContain("<workspace>");
    expect(persisted).toContain("<workspace>");
    for (const exposedPrefix of [workspace, tempPrefix, process.env.HOME]) {
      if (!exposedPrefix) continue;
      expect(returned).not.toContain(exposedPrefix);
      expect(persisted).not.toContain(exposedPrefix);
    }
  });

  it.each([
    { program: "git", args: ["add", "README.md"] },
    { program: "git", args: ["commit", "-m", "message"] },
    { program: "git", args: ["commit", "--amend", "--no-edit"] },
    { program: "git", args: ["push"] },
    { program: "git", args: ["reset", "--hard"] },
    { program: "git", args: ["clean", "-fd"] },
    { program: "git", args: ["checkout", "."] },
    { program: "rm", args: ["-rf", "."] },
    { program: "pnpm", args: ["run", "test"], script: "test" },
    { program: "yarn", args: ["run", "test"], script: "test" },
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
      preview: {
        kind: "terminal_run",
        program: "npm",
        script: "test",
        scriptCommand: "vitest run",
        runner: {
          program: "/bin/sh",
          sha256: sha256(readFileSync("/bin/sh")),
          nonLogin: true,
        },
        environment: {
          path: [
            "<workspace>/node_modules/.bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
          ],
          variables: {
            INIT_CWD: "<workspace>",
            LANG: "C",
            LC_ALL: "C",
            npm_lifecycle_event: "test",
            npm_package_json: "<workspace>/package.json",
          },
          sha256: expect.stringMatching(/^[a-f\d]{64}$/),
        },
      },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(store.getSafeApproval(result.approvalId)).toMatchObject({
      status: "pending",
      sessionId: "session-1",
      runId: "run-1",
      invocationId: result.invocationId,
      toolId: "terminal.run",
      toolVersion: "1.3.0",
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
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        program: "/bin/sh",
        args: ["-c", "vitest run"],
        shell: false,
      }),
    );
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

  it("suppresses npm lifecycle hooks while running the approved script", async () => {
    writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({
        scripts: {
          pretest: "node -e \"require('node:fs').writeFileSync('pre-ran', 'yes')\"",
          test: "node -e \"require('node:fs').writeFileSync('test-ran', 'yes')\"",
          posttest: "node -e \"require('node:fs').writeFileSync('post-ran', 'yes')\"",
        },
      }),
    );
    const realGateway = gateway({ execute: undefined });
    const input = { program: "npm", args: ["run", "test"], script: "test" };
    const pending = await realGateway.invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "terminal.run",
      input,
    });
    if (pending.status !== "approval_required") throw new Error("expected approval");
    realGateway.decideApproval({
      approvalId: pending.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });

    await realGateway.resume({
      sessionId: "session-1",
      runId: "run-1",
      invocationId: pending.invocationId,
      input,
    });

    expect(existsSync(path.join(workspace, "test-ran"))).toBe(true);
    expect(existsSync(path.join(workspace, "pre-ran"))).toBe(false);
    expect(existsSync(path.join(workspace, "post-ran"))).toBe(false);
  });

  it("does not let workspace npm configuration replace the approved runner", async () => {
    writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({ scripts: { test: "printf approved > approved-ran" } }),
    );
    writeFileSync(path.join(workspace, ".npmrc"), "script-shell=./evil-shell\n");
    writeFileSync(
      path.join(workspace, "evil-shell"),
      "#!/bin/sh\nprintf evil > evil-ran\nexit 0\n",
    );
    chmodSync(path.join(workspace, "evil-shell"), 0o755);
    const realGateway = gateway({ execute: undefined });
    const input = { program: "npm", args: ["run", "test"], script: "test" };
    const pending = await realGateway.invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "terminal.run",
      input,
    });
    if (pending.status !== "approval_required") throw new Error("expected approval");
    realGateway.decideApproval({
      approvalId: pending.approvalId,
      sessionId: "session-1",
      decision: "approved",
    });

    await realGateway.resume({
      sessionId: "session-1",
      runId: "run-1",
      invocationId: pending.invocationId,
      input,
    });

    expect(readFileSync(path.join(workspace, "approved-ran"), "utf8")).toBe("approved");
    expect(existsSync(path.join(workspace, "evil-ran"))).toBe(false);
  });

  it("resolves workspace-local binaries without consulting ambient PATH", async () => {
    const localBin = path.join(workspace, "node_modules", ".bin");
    const ambientBin = path.join(projectsRoot, "ambient-bin");
    mkdirSync(localBin, { recursive: true });
    mkdirSync(ambientBin);
    writeFileSync(
      path.join(localBin, "local-tool"),
      [
        "#!/bin/sh",
        "printf '%s\\n' workspace \"$npm_lifecycle_event\" \"$npm_package_json\" \"$INIT_CWD\" > local-ran",
        "",
      ].join("\n"),
    );
    chmodSync(path.join(localBin, "local-tool"), 0o755);
    writeFileSync(
      path.join(ambientBin, "local-tool"),
      "#!/bin/sh\nprintf ambient > ambient-ran\n",
    );
    chmodSync(path.join(ambientBin, "local-tool"), 0o755);
    writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({ scripts: { test: "local-tool" } }),
    );
    const originalPath = process.env.PATH;
    process.env.PATH = `${ambientBin}${path.delimiter}${originalPath ?? ""}`;

    try {
      const realGateway = gateway({ execute: undefined });
      const input = { program: "npm", args: ["run", "test"], script: "test" };
      const pending = await realGateway.invoke({
        sessionId: "session-1",
        runId: "run-1",
        toolId: "terminal.run",
        input,
      });
      if (pending.status !== "approval_required") throw new Error("expected approval");
      realGateway.decideApproval({
        approvalId: pending.approvalId,
        sessionId: "session-1",
        decision: "approved",
      });

      const completed = await realGateway.resume({
        sessionId: "session-1",
        runId: "run-1",
        invocationId: pending.invocationId,
        input,
      });

      expect(completed).toMatchObject({ status: "completed", output: { exitCode: 0 } });
      expect(readFileSync(path.join(workspace, "local-ran"), "utf8")).toBe(
        ["workspace", "test", path.join(workspace, "package.json"), workspace, ""].join("\n"),
      );
      expect(existsSync(path.join(workspace, "ambient-ran"))).toBe(false);
      expect(existsSync(path.join(ambientBin, "ambient-ran"))).toBe(false);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  it("revalidates the workspace binary directory immediately before launch", async () => {
    const localBin = path.join(workspace, "node_modules", ".bin");
    const movedBin = path.join(workspace, "node_modules", ".bin-original");
    const outsideBin = path.join(projectsRoot, "outside-bin");
    mkdirSync(localBin, { recursive: true });
    mkdirSync(outsideBin);
    let runnerReads = 0;
    const injectedFileSystem: SafeToolFileSystem = {
      readFile: (filePath) => {
        const content = readFileSync(filePath);
        if (filePath === "/bin/sh" && ++runnerReads === 3) {
          renameSync(localBin, movedBin);
          symlinkSync(outsideBin, localBin);
        }
        return content;
      },
      lstat: (filePath) => lstatSync(filePath),
      mkdir: (directoryPath, options) => mkdirSync(directoryPath, options),
      writeFile: (filePath, value, options) => writeFileSync(filePath, value, options),
      rename: (from, to) => renameSync(from, to),
      unlink: (filePath) => unlinkSync(filePath),
    };
    const exactGateway = gateway({ fileSystem: injectedFileSystem });
    const input = { program: "npm", args: ["run", "test"], script: "test" };
    const pending = await exactGateway.invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "terminal.run",
      input,
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
        input,
      }),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("revalidates the bound runner immediately before process launch", async () => {
    let runnerReads = 0;
    const injectedFileSystem: SafeToolFileSystem = {
      readFile: (filePath) => {
        if (filePath === "/bin/sh" && ++runnerReads === 3) return Buffer.from("changed-runner");
        return readFileSync(filePath);
      },
      lstat: (filePath) => lstatSync(filePath),
      mkdir: (directoryPath, options) => mkdirSync(directoryPath, options),
      writeFile: (filePath, value, options) => writeFileSync(filePath, value, options),
      rename: (from, to) => renameSync(from, to),
      unlink: (filePath) => unlinkSync(filePath),
    };
    const exactGateway = gateway({ fileSystem: injectedFileSystem });
    const input = { program: "npm", args: ["run", "test"], script: "test" };
    const pending = await exactGateway.invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "terminal.run",
      input,
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
        input,
      }),
    ).rejects.toThrow("approval_binding_mismatch");
    expect(execute).not.toHaveBeenCalled();
  });

  it("revalidates the selected script immediately before process launch", async () => {
    let packageReads = 0;
    const injectedFileSystem: SafeToolFileSystem = {
      readFile: (filePath) => {
        const content = readFileSync(filePath);
        if (filePath === path.join(workspace, "package.json") && ++packageReads === 2) {
          writeFileSync(
            filePath,
            JSON.stringify({ scripts: { test: "node changed-command.js" } }),
          );
        }
        return content;
      },
      lstat: (filePath) => lstatSync(filePath),
      mkdir: (directoryPath, options) => mkdirSync(directoryPath, options),
      writeFile: (filePath, value, options) => writeFileSync(filePath, value, options),
      rename: (from, to) => renameSync(from, to),
      unlink: (filePath) => unlinkSync(filePath),
    };
    const exactGateway = gateway({ fileSystem: injectedFileSystem });
    const input = { program: "npm", args: ["run", "test"], script: "test" };
    const pending = await exactGateway.invoke({
      sessionId: "session-1",
      runId: "run-1",
      toolId: "terminal.run",
      input,
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
        input,
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

  it.skip("creates only the exact nonexistent project child after approval (Builder retired)", async () => {
    store.createRun({
      runId: "builder-run",
      sessionId: "session-1",
      agentId: "Hermes",
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
