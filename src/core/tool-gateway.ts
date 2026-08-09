import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { AgentCatalog } from "./agent-catalog";
import { getAgent } from "./agent-catalog";
import type { CoreRun, CoreStore, JsonValue } from "./core-store";
import { redactSecrets, redactStructured } from "./policy";
import {
  getSafeToolManifest,
  type SafeToolId,
  type SafeToolManifest,
} from "./safe-tool-manifests";

const APPROVAL_TTL_MS = 10 * 60 * 1000;
const SCRIPT_RUNNER = "/bin/sh";
const SCRIPT_SYSTEM_PATH = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
] as const;
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const META = /[;&|><`$()\\\r\n]/;
const SENSITIVE_COMPONENT = /^(?:\.git|\.env(?:\..*)?|\.npmrc|\.netrc|\.ssh|credentials?(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i;
const OUTPUT_FLAG = /^(?:-o|--output|--output-file|--replace|--write)(?:=|$)/;

export interface SafeProcessRequest {
  program: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
  shell: false;
}

export interface SafeProcessOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type SafeProcessExecutor = (
  request: SafeProcessRequest,
) => Promise<SafeProcessOutput>;

interface FileStatus {
  isSymbolicLink(): boolean;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface SafeToolFileSystem {
  readFile(filePath: string): Buffer;
  lstat(filePath: string): FileStatus;
  mkdir(directoryPath: string, options?: { recursive?: boolean }): void;
  writeFile(filePath: string, value: string, options?: { flag?: string }): void;
  rename(from: string, to: string): void;
  unlink(filePath: string): void;
}

export interface SafeToolGatewayOptions {
  store: CoreStore;
  catalog: AgentCatalog;
  execute?: SafeProcessExecutor;
  fileSystem?: SafeToolFileSystem;
  clock?: () => Date;
  randomId?: () => string;
}

export type GatewayResult =
  | {
      status: "completed";
      invocationId: string;
      runId: string;
      toolId: SafeToolId;
      output: unknown;
    }
  | {
      status: "approval_required";
      invocationId: string;
      approvalId: string;
      runId: string;
      toolId: SafeToolId;
      expiresAt: string;
      preview: JsonValue;
    };

interface PreparedTool {
  input: JsonValue;
  effect: JsonValue;
  preview: JsonValue;
  run(): Promise<unknown>;
}

interface ParsedPatch {
  path: string;
  oldPath: string | null;
  hunks: string[];
}

const defaultFileSystem: SafeToolFileSystem = {
  readFile: (filePath) => readFileSync(filePath),
  lstat: (filePath) => lstatSync(filePath),
  mkdir: (directoryPath, options) => mkdirSync(directoryPath, options),
  writeFile: (filePath, value, options) => writeFileSync(filePath, value, options),
  rename: (from, to) => renameSync(from, to),
  unlink: (filePath) => unlinkSync(filePath),
};

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        entry === undefined ? [] : [[key, toJsonValue(entry)]],
      ),
    );
  }
  throw new TypeError("tool_value_not_json");
}

function stableValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value: JsonValue): string {
  return JSON.stringify(stableValue(value));
}

function digest(value: JsonValue): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function textDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bufferDigest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function bindingDigest(input: {
  sessionId: string;
  runId: string;
  invocationId: string;
  toolId: string;
  toolVersion: string;
  input: JsonValue;
  workspace: JsonValue;
  effect: JsonValue;
  sideEffect: string;
  idempotent: boolean;
}): string {
  return digest(toJsonValue(input));
}

function fail(code: string): never {
  throw new Error(code);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function assertSafeRelativePath(relativePath: string): string[] {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.includes("\0")
  ) {
    fail("unsafe_path");
  }
  const components = relativePath.split("/");
  if (
    components.some(
      (component) =>
        !component || component === "." || component === ".." || SENSITIVE_COMPONENT.test(component),
    )
  ) {
    fail("unsafe_path");
  }
  return components;
}

function resolveSafePath(
  root: string,
  relativePath: string,
  fs: SafeToolFileSystem,
  allowMissingFinal: boolean,
): string {
  const rootStatus = fs.lstat(root);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) fail("unsafe_path");
  const components = assertSafeRelativePath(relativePath);
  const target = path.resolve(root, ...components);
  const fromRoot = path.relative(root, target);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    fail("unsafe_path");
  }
  let current = root;
  for (const [index, component] of components.entries()) {
    current = path.join(current, component);
    try {
      const status = fs.lstat(current);
      if (status.isSymbolicLink()) fail("unsafe_path");
      if (index < components.length - 1 && !status.isDirectory()) fail("unsafe_path");
    } catch (error) {
      if (allowMissingFinal && isMissing(error)) return target;
      throw error;
    }
  }
  return target;
}

function workspacePath(run: CoreRun): string {
  const workspace = run.workspace as { kind?: unknown; path?: unknown };
  if (
    (workspace.kind !== "existing" && workspace.kind !== "new") ||
    typeof workspace.path !== "string" ||
    !path.isAbsolute(workspace.path)
  ) {
    fail("workspace_required");
  }
  return workspace.path;
}

function assertNoUnsafeArg(arg: string): void {
  const components = arg.split("/");
  if (
    META.test(arg) ||
    arg.length === 0 ||
    components.includes("..") ||
    components.some((component) => SENSITIVE_COMPONENT.test(component))
  ) {
    fail("unsafe_terminal_argument");
  }
  if (
    path.isAbsolute(arg) ||
    /(^|=)\//.test(arg) ||
    /(^|=)\.\.(?:[/\\]|$)/.test(arg) ||
    /(^|[=:/\\])\.env(?:\.|$)/i.test(arg) ||
    /(^|[=:/\\])\.git(?:[/\\]|$)/i.test(arg) ||
    OUTPUT_FLAG.test(arg)
  ) {
    fail("unsafe_terminal_argument");
  }
}

interface TerminalReadCommand {
  program: string;
  args: string[];
}

function resolveTerminalReadOperand(
  root: string,
  operand: string,
  fs: SafeToolFileSystem,
  fileOnly: boolean,
): string {
  if (operand === ".") {
    const status = fs.lstat(root);
    if (status.isSymbolicLink() || !status.isDirectory()) fail("unsafe_terminal_read");
    return root;
  }
  const resolved = resolveSafePath(root, operand, fs, false);
  const status = fs.lstat(resolved);
  if (status.isSymbolicLink() || (fileOnly && !status.isFile())) {
    fail("unsafe_terminal_read");
  }
  return resolved;
}

function prepareTerminalReadCommand(
  root: string,
  input: TerminalReadCommand,
  fs: SafeToolFileSystem,
): TerminalReadCommand {
  const { program, args } = input;
  if (program.includes("/") || program.includes("\\")) fail("unsafe_terminal_read");
  try {
    args.forEach(assertNoUnsafeArg);

    if (program === "pwd" && args.length === 0) return { program, args };
    if (program === "git") {
      const statusOptions = new Set([
        "--short",
        "--branch",
        "--porcelain",
        "--porcelain=v1",
        "--porcelain=v2",
        "--untracked-files=no",
        "--untracked-files=normal",
        "--untracked-files=all",
        "-s",
        "-b",
        "-sb",
      ]);
      if (
        args[0] === "status" &&
        args.slice(1).every((argument) => statusOptions.has(argument))
      ) {
        return { program, args };
      }
      if (
        args[0] === "branch" &&
        (args.length === 1 ||
          (args.length === 2 && ["--list", "--show-current"].includes(args[1])))
      ) {
        return { program, args };
      }
      fail("unsafe_terminal_read");
    }

    if (program === "ls") {
      const optionCount = args.findIndex((argument) => !/^-[1ahl]+$/.test(argument));
      const splitAt = optionCount === -1 ? args.length : optionCount;
      const options = args.slice(0, splitAt);
      const operands = args.slice(splitAt);
      if (operands.some((operand) => operand.startsWith("-"))) fail("unsafe_terminal_read");
      const resolved = (operands.length ? operands : ["."]).map((operand) =>
        resolveTerminalReadOperand(root, operand, fs, false),
      );
      return { program, args: [...options, ...resolved] };
    }

    if (program === "cat") {
      if (!args.length || args.some((operand) => operand.startsWith("-"))) {
        fail("unsafe_terminal_read");
      }
      return {
        program,
        args: args.map((operand) => resolveTerminalReadOperand(root, operand, fs, true)),
      };
    }

    if (program === "head" || program === "tail") {
      let operandIndex = 0;
      const options: string[] = [];
      if (args[0] === "-n" && /^[1-9]\d*$/.test(args[1] ?? "")) {
        options.push(args[0], args[1]);
        operandIndex = 2;
      } else if (/^(?:-n|--lines=)[1-9]\d*$/.test(args[0] ?? "")) {
        options.push(args[0]);
        operandIndex = 1;
      }
      const operands = args.slice(operandIndex);
      if (!operands.length || operands.some((operand) => operand.startsWith("-"))) {
        fail("unsafe_terminal_read");
      }
      return {
        program,
        args: [
          ...options,
          ...operands.map((operand) => resolveTerminalReadOperand(root, operand, fs, true)),
        ],
      };
    }

    if (program === "wc") {
      const optionCount = args.findIndex((argument) => !/^-[clmw]+$/.test(argument));
      const splitAt = optionCount === -1 ? args.length : optionCount;
      const options = args.slice(0, splitAt);
      const operands = args.slice(splitAt);
      if (!operands.length || operands.some((operand) => operand.startsWith("-"))) {
        fail("unsafe_terminal_read");
      }
      return {
        program,
        args: [
          ...options,
          ...operands.map((operand) => resolveTerminalReadOperand(root, operand, fs, true)),
        ],
      };
    }

    if (program === "rg") {
      const allowedOptions = new Set([
        "-n",
        "--line-number",
        "-i",
        "--ignore-case",
        "-F",
        "--fixed-strings",
        "-w",
        "--word-regexp",
        "-x",
        "--line-regexp",
        "-l",
        "--files-with-matches",
        "-c",
        "--count",
        "--json",
        "--heading",
        "--no-heading",
        "--color=never",
      ]);
      const optionCount = args.findIndex((argument) => !allowedOptions.has(argument));
      const splitAt = optionCount === -1 ? args.length : optionCount;
      const options = args.slice(0, splitAt);
      const pattern = args[splitAt];
      const operands = args.slice(splitAt + 1);
      if (!pattern || pattern.startsWith("-") || operands.some((operand) => operand.startsWith("-"))) {
        fail("unsafe_terminal_read");
      }
      const resolved = (operands.length ? operands : ["."]).map((operand) =>
        resolveTerminalReadOperand(root, operand, fs, false),
      );
      return { program, args: [...options, pattern, ...resolved] };
    }
  } catch {
    fail("unsafe_terminal_read");
  }
  fail("unsafe_terminal_read");
}

function loadProjectScripts(root: string, fs: SafeToolFileSystem): Record<string, string> {
  const packagePath = resolveSafePath(root, "package.json", fs, false);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFile(packagePath).toString("utf8"));
  } catch {
    fail("unsafe_terminal_run");
  }
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    fail("unsafe_terminal_run");
  }
  const entries = Object.entries(scripts);
  if (entries.some((entry): boolean => typeof entry[1] !== "string")) {
    fail("unsafe_terminal_run");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

interface ProjectScriptEnvironment {
  values: NodeJS.ProcessEnv;
  contract: {
    path: string[];
    variables: Record<string, string>;
    sha256: string;
  };
}

function prepareProjectScriptEnvironment(
  root: string,
  script: string,
  fs: SafeToolFileSystem,
): ProjectScriptEnvironment {
  const localBin = resolveSafePath(root, "node_modules/.bin", fs, true);
  try {
    const status = fs.lstat(localBin);
    if (status.isSymbolicLink() || !status.isDirectory()) fail("unsafe_terminal_run");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const packagePath = resolveSafePath(root, "package.json", fs, false);
  const variables = {
    INIT_CWD: root,
    LANG: "C",
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    npm_lifecycle_event: script,
    npm_package_json: packagePath,
  };
  const values = {
    PATH: [localBin, ...SCRIPT_SYSTEM_PATH].join(path.delimiter),
    ...variables,
  } as unknown as NodeJS.ProcessEnv;
  return {
    values,
    contract: {
      path: ["<workspace>/node_modules/.bin", ...SCRIPT_SYSTEM_PATH],
      variables: {
        ...variables,
        INIT_CWD: "<workspace>",
        npm_package_json: "<workspace>/package.json",
      },
      sha256: digest(toJsonValue(values)),
    },
  };
}

function assertTerminalRun(
  root: string,
  input: { program: string; args: string[]; script?: string },
  fs: SafeToolFileSystem,
): {
  networkCapable: true;
  scriptCommand: string;
  scriptDigest: string;
  runner: { program: string; args: string[]; sha256: string; nonLogin: true };
  environment: ProjectScriptEnvironment;
} {
  if (input.program.includes("/") || input.program.includes("\\")) fail("unsafe_terminal_run");
  try {
    input.args.forEach(assertNoUnsafeArg);
  } catch {
    fail("unsafe_terminal_run");
  }
  if (input.program === "npm") {
    const scripts = loadProjectScripts(root, fs);
    if (
      !input.script ||
      input.args.length !== 2 ||
      input.args[0] !== "run" ||
      input.args[1] !== input.script ||
      !Object.prototype.hasOwnProperty.call(scripts, input.script)
    ) {
      fail("unsafe_terminal_run");
    }
    const runner = {
      program: SCRIPT_RUNNER,
      args: ["-c"],
      sha256: bufferDigest(fs.readFile(SCRIPT_RUNNER)),
      nonLogin: true as const,
    };
    const environment = prepareProjectScriptEnvironment(root, input.script, fs);
    return {
      networkCapable: true,
      scriptCommand: scripts[input.script],
      scriptDigest: textDigest(scripts[input.script]),
      runner,
      environment,
    };
  }
  fail("unsafe_terminal_run");
}

function processEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    ...Object.fromEntries(
    ["PATH", "TMPDIR", "LANG", "LC_ALL", "CI", "NO_COLOR"].flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]!]],
    ),
    ),
  };
}

const defaultExecutor: SafeProcessExecutor = (request) =>
  new Promise((resolve, reject) => {
    execFile(
      request.program,
      request.args,
      {
        cwd: request.cwd,
        env: request.env,
        timeout: request.timeoutMs,
        maxBuffer: request.maxOutputBytes,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error && (error.killed || error.signal)) {
          reject(Object.assign(error, { effectStarted: true }));
          return;
        }
        resolve({
          exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          timedOut: false,
        });
      },
    );
  });

function truncate(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  const buffer = Buffer.from(value);
  return `${buffer.subarray(0, Math.max(0, maxBytes - 32)).toString("utf8")}\n…[truncated]`;
}

function normalizeWorkspacePath(value: string, root: string): string {
  const jsonEscapedRoot = JSON.stringify(root).slice(1, -1);
  return value
    .split(jsonEscapedRoot)
    .join("<workspace>")
    .split(root)
    .join("<workspace>");
}

function normalizeTerminalReadOutput(output: SafeProcessOutput, root: string): SafeProcessOutput {
  return {
    ...output,
    stdout: normalizeWorkspacePath(output.stdout, root),
    stderr: normalizeWorkspacePath(output.stderr, root),
  };
}

function sanitizeOutput(manifest: SafeToolManifest, output: unknown): JsonValue {
  let value = manifest.outputSchema.parse(output) as unknown;
  if (manifest.id === "terminal.read" || manifest.id === "terminal.run") {
    const process = value as SafeProcessOutput;
    const budget = Math.floor(manifest.maxOutputBytes / 2);
    value = {
      ...process,
      stdout: truncate(redactSecrets(process.stdout), budget),
      stderr: truncate(redactSecrets(process.stderr), budget),
    };
  }
  if (manifest.id === "file.patch") {
    const patch = value as { applied: boolean; paths: string[]; diff: string };
    value = { ...patch, diff: truncate(redactSecrets(patch.diff), manifest.maxOutputBytes / 2) };
  }
  const sanitized = toJsonValue(redactStructured(value));
  if (Buffer.byteLength(stableJson(sanitized)) > manifest.maxOutputBytes) {
    fail("tool_output_too_large");
  }
  manifest.outputSchema.parse(sanitized);
  return sanitized;
}

function parseHeaderPath(value: string, prefix: "a/" | "b/"): string | null {
  const raw = value.slice(4).split("\t", 1)[0].trim();
  if (raw === "/dev/null") return null;
  if (!raw.startsWith(prefix) || raw.includes('"')) fail("unsafe_patch");
  return raw.slice(2);
}

function parseUnifiedDiff(diff: string): ParsedPatch[] {
  if (/GIT binary patch|Binary files|\0/.test(diff)) fail("unsafe_patch");
  const lines = diff.split("\n");
  const files: ParsedPatch[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].startsWith("--- ")) {
      if (lines[index] !== "") fail("unsafe_patch");
      index += 1;
      continue;
    }
    const oldPath = parseHeaderPath(lines[index], "a/");
    index += 1;
    if (index >= lines.length || !lines[index].startsWith("+++ ")) fail("unsafe_patch");
    const newPath = parseHeaderPath(lines[index], "b/");
    if (!newPath || (oldPath !== null && oldPath !== newPath)) fail("unsafe_patch");
    index += 1;
    const hunks: string[] = [];
    while (index < lines.length && !lines[index].startsWith("--- ")) {
      if (lines[index] !== "") hunks.push(lines[index]);
      index += 1;
    }
    if (!hunks.some((line) => line.startsWith("@@ "))) fail("unsafe_patch");
    files.push({ path: newPath, oldPath, hunks });
  }
  if (!files.length) fail("unsafe_patch");
  return files;
}

function applyHunks(original: string, hunks: string[], creating: boolean): string {
  const trailingNewline = original.endsWith("\n") || creating;
  const source = original === "" ? [] : original.replace(/\n$/, "").split("\n");
  const output: string[] = [];
  let sourceIndex = 0;
  let index = 0;
  while (index < hunks.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(hunks[index]);
    if (!header) fail("invalid_patch_hunk");
    const start = Math.max(0, Number(header[1]) - 1);
    if (start < sourceIndex || start > source.length) fail("invalid_patch_hunk");
    output.push(...source.slice(sourceIndex, start));
    sourceIndex = start;
    index += 1;
    while (index < hunks.length && !hunks[index].startsWith("@@ ")) {
      const line = hunks[index];
      if (line === "\\ No newline at end of file") {
        index += 1;
        continue;
      }
      const marker = line[0];
      const content = line.slice(1);
      if (marker === " ") {
        if (source[sourceIndex] !== content) fail("patch_context_mismatch");
        output.push(content);
        sourceIndex += 1;
      } else if (marker === "-") {
        if (source[sourceIndex] !== content) fail("patch_context_mismatch");
        sourceIndex += 1;
      } else if (marker === "+") {
        output.push(content);
      } else {
        fail("invalid_patch_hunk");
      }
      index += 1;
    }
  }
  output.push(...source.slice(sourceIndex));
  return `${output.join("\n")}${trailingNewline ? "\n" : ""}`;
}

export class SafeToolGateway {
  private readonly execute: SafeProcessExecutor;
  private readonly fs: SafeToolFileSystem;
  private readonly clock: () => Date;
  private readonly randomId: () => string;

  constructor(private readonly options: SafeToolGatewayOptions) {
    this.execute = options.execute ?? defaultExecutor;
    this.fs = options.fileSystem ?? defaultFileSystem;
    this.clock = options.clock ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
  }

  async invoke(request: {
    sessionId: string;
    runId: string;
    toolId: string;
    input: unknown;
  }): Promise<GatewayResult> {
    const { run, manifest } = this.authorize(request);
    const invocationId = this.randomId();
    const prepared = this.prepare(run, manifest, request.input);
    const requestedAt = this.clock();
    const createdAt = requestedAt.toISOString();
    const inputDigest = digest(prepared.input);
    const workspaceDigest = digest(run.workspace);
    const binding = bindingDigest({
      sessionId: request.sessionId,
      runId: request.runId,
      invocationId,
      toolId: manifest.id,
      toolVersion: manifest.version,
      input: prepared.input,
      workspace: run.workspace,
      effect: prepared.effect,
      sideEffect: manifest.sideEffect,
      idempotent: manifest.idempotent,
    });

    if (manifest.sideEffect !== "none") {
      const approvalId = this.randomId();
      const expiresAt = new Date(requestedAt.getTime() + APPROVAL_TTL_MS).toISOString();
      this.options.store.createSafeInvocation({
        invocationId,
        approvalId,
        sessionId: request.sessionId,
        runId: request.runId,
        toolId: manifest.id,
        toolVersion: manifest.version,
        input: prepared.input,
        inputDigest,
        workspace: run.workspace,
        workspaceDigest,
        bindingDigest: binding,
        effect: prepared.effect,
        sideEffect: manifest.sideEffect,
        idempotent: manifest.idempotent,
        createdAt,
        expiresAt,
      });
      return {
        status: "approval_required",
        invocationId,
        approvalId,
        runId: request.runId,
        toolId: manifest.id,
        expiresAt,
        preview: toJsonValue(redactStructured(prepared.preview)),
      };
    }

    this.options.store.createSafeInvocation({
      invocationId,
      sessionId: request.sessionId,
      runId: request.runId,
      toolId: manifest.id,
      toolVersion: manifest.version,
      input: prepared.input,
      inputDigest,
      workspace: run.workspace,
      workspaceDigest,
      bindingDigest: binding,
      effect: prepared.effect,
      sideEffect: manifest.sideEffect,
      idempotent: manifest.idempotent,
      createdAt,
    });
    return this.runClaimed(run, manifest, invocationId, prepared);
  }

  decideApproval(request: {
    approvalId: string;
    sessionId: string;
    decision: "approved" | "denied";
  }) {
    return this.options.store.decideSafeApproval({
      ...request,
      now: this.clock().toISOString(),
    });
  }

  async resume(request: {
    sessionId: string;
    runId: string;
    invocationId: string;
    input: unknown;
  }): Promise<GatewayResult> {
    const existing = this.options.store.getSafeInvocation(request.invocationId);
    if (!existing) fail("invocation_not_found");
    const { run, manifest } = this.authorize({
      sessionId: request.sessionId,
      runId: request.runId,
      toolId: existing.toolId,
      input: request.input,
    });
    if (
      existing.sessionId !== request.sessionId ||
      existing.runId !== request.runId ||
      existing.toolVersion !== manifest.version ||
      existing.workspaceDigest !== digest(run.workspace)
    ) {
      fail("approval_binding_mismatch");
    }
    const prepared = this.prepare(run, manifest, request.input);
    const inputDigest = digest(prepared.input);
    const workspaceDigest = digest(run.workspace);
    const binding = bindingDigest({
      sessionId: request.sessionId,
      runId: request.runId,
      invocationId: request.invocationId,
      toolId: manifest.id,
      toolVersion: manifest.version,
      input: prepared.input,
      workspace: run.workspace,
      effect: prepared.effect,
      sideEffect: manifest.sideEffect,
      idempotent: manifest.idempotent,
    });
    this.options.store.claimSafeInvocation({
      invocationId: request.invocationId,
      sessionId: request.sessionId,
      runId: request.runId,
      toolId: manifest.id,
      toolVersion: manifest.version,
      input: prepared.input,
      inputDigest,
      workspace: run.workspace,
      workspaceDigest,
      bindingDigest: binding,
      effect: prepared.effect,
      sideEffect: manifest.sideEffect,
      idempotent: manifest.idempotent,
      now: this.clock().toISOString(),
    });
    return this.runClaimed(run, manifest, request.invocationId, prepared);
  }

  private authorize(request: {
    sessionId: string;
    runId: string;
    toolId: string;
    input: unknown;
  }): { run: CoreRun; manifest: SafeToolManifest } {
    const run = this.options.store.getRun(request.runId);
    if (!run || run.sessionId !== request.sessionId) fail("run_binding_mismatch");
    if (["completed", "cancelled", "canceled", "failed"].includes(run.status)) {
      fail("run_not_active");
    }
    const agent = getAgent(this.options.catalog, run.agentId);
    const manifest = getSafeToolManifest(request.toolId);
    if (
      !agent ||
      !manifest ||
      !agent.tools.includes(manifest.id) ||
      (agent.mutationMode === "none" && manifest.sideEffect !== "none")
    ) {
      fail("tool_not_allowed");
    }
    return { run, manifest };
  }

  private prepare(run: CoreRun, manifest: SafeToolManifest, rawInput: unknown): PreparedTool {
    const input = toJsonValue(manifest.inputSchema.parse(rawInput));
    const root = workspacePath(run);
    if (manifest.id === "code.context") return this.prepareCodeContext(root, input);
    if (manifest.id === "terminal.read") return this.prepareTerminalRead(root, input, manifest);
    if (manifest.id === "terminal.run") return this.prepareTerminalRun(root, input, manifest);
    if (manifest.id === "file.patch") return this.prepareFilePatch(root, input);
    return this.prepareProjectCreate(run, input);
  }

  private prepareCodeContext(root: string, input: JsonValue): PreparedTool {
    const parsed = input as { paths: string[] };
    const paths = parsed.paths.map((relativePath) => {
      try {
        return { relativePath, absolutePath: resolveSafePath(root, relativePath, this.fs, false) };
      } catch {
        fail("unsafe_code_context");
      }
    });
    return {
      input,
      effect: { kind: "read_context", paths: parsed.paths },
      preview: { kind: "read_context", paths: parsed.paths },
      run: async () => {
        let remaining = 90_000;
        return {
          files: paths.map(({ relativePath, absolutePath }) => {
            const revalidated = resolveSafePath(root, relativePath, this.fs, false);
            if (revalidated !== absolutePath) fail("unsafe_code_context");
            const bytes = this.fs.readFile(revalidated);
            const content = truncate(bytes.toString("utf8"), Math.max(0, remaining));
            remaining -= Buffer.byteLength(content);
            return {
              path: relativePath,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              bytes: bytes.length,
              content,
            };
          }),
        };
      },
    };
  }

  private prepareTerminalRead(root: string, input: JsonValue, manifest: SafeToolManifest): PreparedTool {
    const parsed = input as { program: string; args: string[] };
    const command = prepareTerminalReadCommand(root, parsed, this.fs);
    return {
      input,
      effect: { kind: "terminal_read", program: parsed.program, args: parsed.args },
      preview: { kind: "terminal_read", program: parsed.program, args: parsed.args },
      run: () => {
        const revalidated = prepareTerminalReadCommand(root, parsed, this.fs);
        if (stableJson(toJsonValue(revalidated)) !== stableJson(toJsonValue(command))) {
          fail("unsafe_terminal_read");
        }
        return this.execute({
          ...revalidated,
          cwd: root,
          env: { ...processEnvironment(), GIT_OPTIONAL_LOCKS: "0" },
          timeoutMs: manifest.timeoutMs,
          maxOutputBytes: manifest.maxOutputBytes,
          shell: false,
        }).then((output) => normalizeTerminalReadOutput(output, root));
      },
    };
  }

  private prepareTerminalRun(root: string, input: JsonValue, manifest: SafeToolManifest): PreparedTool {
    const parsed = input as { program: string; args: string[]; script?: string };
    const { networkCapable, scriptCommand, scriptDigest, runner, environment } =
      assertTerminalRun(root, parsed, this.fs);
    const effectDetails = {
      kind: "terminal_run",
      program: parsed.program,
      args: parsed.args,
      script: parsed.script,
      scriptDigest,
      networkCapable,
      runner,
      environment: environment.contract,
    };
    const effect = toJsonValue(effectDetails);
    return {
      input,
      effect,
      preview: toJsonValue({
        ...effectDetails,
        ...(scriptCommand ? { scriptCommand: redactSecrets(scriptCommand) } : {}),
      }),
      run: () => {
        let revalidated: ReturnType<typeof assertTerminalRun>;
        try {
          revalidated = assertTerminalRun(root, parsed, this.fs);
        } catch (error) {
          if (error && typeof error === "object") Object.assign(error, { effectStarted: false });
          throw error;
        }
        if (
          revalidated.scriptCommand !== scriptCommand ||
          revalidated.scriptDigest !== scriptDigest ||
          stableJson(toJsonValue(revalidated.runner)) !== stableJson(toJsonValue(runner)) ||
          stableJson(toJsonValue(revalidated.environment.contract)) !==
            stableJson(toJsonValue(environment.contract))
        ) {
          throw Object.assign(new Error("approval_binding_mismatch"), { effectStarted: false });
        }
        return this.execute({
          program: runner.program,
          args: [...runner.args, scriptCommand],
          cwd: root,
          env: revalidated.environment.values,
          timeoutMs: manifest.timeoutMs,
          maxOutputBytes: manifest.maxOutputBytes,
          shell: false,
        });
      },
    };
  }

  private prepareFilePatch(root: string, input: JsonValue): PreparedTool {
    const parsed = input as { diff: string; preimageHashes: Record<string, string> };
    let files: ParsedPatch[];
    try {
      files = parseUnifiedDiff(parsed.diff);
      for (const file of files) resolveSafePath(root, file.path, this.fs, true);
      const expected = Object.keys(parsed.preimageHashes).sort();
      const actual = files.map((file) => file.path).sort();
      if (stableJson(expected) !== stableJson(actual)) fail("unsafe_patch");
    } catch {
      fail("unsafe_patch");
    }
    const effect = toJsonValue({
      kind: "file_patch",
      paths: files.map((file) => file.path),
      diffSha256: digest(parsed.diff),
      preimageHashes: parsed.preimageHashes,
    });
    return {
      input,
      effect,
      preview: {
        kind: "file_patch",
        paths: files.map((file) => file.path),
        diff: truncate(redactSecrets(parsed.diff), 100_000),
      },
      run: async () => this.applyPatch(root, parsed, files),
    };
  }

  private prepareProjectCreate(run: CoreRun, input: JsonValue): PreparedTool {
    const parsed = input as { name: string };
    const workspace = run.workspace as { kind?: unknown; name?: unknown; path?: unknown };
    if (
      workspace.kind !== "new" ||
      workspace.name !== parsed.name ||
      typeof workspace.path !== "string" ||
      !PROJECT_NAME.test(parsed.name) ||
      path.basename(workspace.path) !== parsed.name ||
      path.join(path.dirname(workspace.path), parsed.name) !== workspace.path
    ) {
      fail("unsafe_project_create");
    }
    const parent = path.dirname(workspace.path);
    const assertAvailable = () => {
      const parentStatus = this.fs.lstat(parent);
      if (parentStatus.isSymbolicLink() || !parentStatus.isDirectory()) fail("unsafe_project_create");
      try {
        this.fs.lstat(workspace.path as string);
        fail("project_already_exists");
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    };
    assertAvailable();
    const effect = toJsonValue({ kind: "project_create", name: parsed.name, path: workspace.path });
    return {
      input,
      effect,
      preview: effect,
      run: async () => {
        assertAvailable();
        this.fs.mkdir(workspace.path as string);
        return { name: parsed.name, path: workspace.path, created: true };
      },
    };
  }

  private async applyPatch(
    root: string,
    input: { diff: string; preimageHashes: Record<string, string> },
    files: ParsedPatch[],
  ) {
    let effectStarted = false;
    try {
      const updates = files.map((file) => {
        const target = resolveSafePath(root, file.path, this.fs, true);
        let original = "";
        let exists = true;
        try {
          const status = this.fs.lstat(target);
          if (status.isSymbolicLink() || !status.isFile()) fail("unsafe_patch");
          original = this.fs.readFile(target).toString("utf8");
        } catch (error) {
          if (!isMissing(error)) throw error;
          exists = false;
        }
        const expected = input.preimageHashes[file.path].toLowerCase();
        if ((file.oldPath === null) !== !exists) fail("preimage_hash_mismatch");
        if (textDigest(original) !== expected || (!exists && expected !== EMPTY_SHA256)) {
          fail("preimage_hash_mismatch");
        }
        return {
          file,
          target,
          existed: exists,
          expected,
          content: applyHunks(original, file.hunks, !exists),
          temporary: path.join(path.dirname(target), `.jarvis-patch-${this.randomId()}.tmp`),
        };
      });
      const temporaries: string[] = [];
      for (const update of updates) {
        this.fs.mkdir(path.dirname(update.target), { recursive: true });
        this.fs.writeFile(update.temporary, update.content, { flag: "wx" });
        temporaries.push(update.temporary);
      }
      for (const update of updates) {
        const target = resolveSafePath(root, update.file.path, this.fs, true);
        let current = "";
        let exists = true;
        try {
          const status = this.fs.lstat(target);
          if (status.isSymbolicLink() || !status.isFile()) fail("unsafe_patch");
          current = this.fs.readFile(target).toString("utf8");
        } catch (error) {
          if (!isMissing(error)) throw error;
          exists = false;
        }
        if (exists !== update.existed || textDigest(current) !== update.expected) {
          fail("preimage_hash_mismatch");
        }
      }
      try {
        for (const update of updates) {
          resolveSafePath(root, path.relative(root, update.target).split(path.sep).join("/"), this.fs, true);
          effectStarted = true;
          this.fs.rename(update.temporary, update.target);
          temporaries.splice(temporaries.indexOf(update.temporary), 1);
        }
      } finally {
        for (const temporary of temporaries) {
          try {
            this.fs.unlink(temporary);
          } catch {
            // Best-effort cleanup; no target was renamed for this temporary.
          }
        }
      }
      return {
        applied: true,
        paths: files.map((file) => file.path),
        diff: truncate(redactSecrets(input.diff), 100_000),
      };
    } catch (error) {
      if (error && typeof error === "object") {
        Object.assign(error, { effectStarted });
      }
      throw error;
    }
  }

  private async runClaimed(
    run: CoreRun,
    manifest: SafeToolManifest,
    invocationId: string,
    prepared: PreparedTool,
  ): Promise<GatewayResult> {
    try {
      const output = sanitizeOutput(manifest, await prepared.run());
      this.options.store.finishSafeInvocation({
        invocationId,
        status: "completed",
        output,
        now: this.clock().toISOString(),
      });
      return { status: "completed", invocationId, runId: run.runId, toolId: manifest.id, output };
    } catch (error) {
      const possiblyStarted =
        manifest.sideEffect !== "none" &&
        (error as { effectStarted?: boolean }).effectStarted !== false;
      this.options.store.finishSafeInvocation({
        invocationId,
        status: possiblyStarted ? "unknown" : "failed",
        error: { code: possiblyStarted ? "effect_outcome_unknown" : "tool_execution_failed" },
        now: this.clock().toISOString(),
      });
      if (possiblyStarted) fail("effect_outcome_unknown");
      throw error;
    }
  }
}
