import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redactSecrets } from "@/core/policy";
import { getTool } from "./registry";
import {
  type ClassifiedCommand,
  classifyCommand,
  getShellRoot,
} from "./shell-policy";

const execFileAsync = promisify(execFile);

export interface ShellRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cwd: string;
  classified: ClassifiedCommand;
}

export interface ShellRunOptions {
  command: string;
  /** Required when classified tier is confirm. */
  approved?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncado ${text.length - max} chars]`;
}

export async function runShellCommand(
  options: ShellRunOptions,
): Promise<ShellRunResult> {
  const tool = getTool("shell.run");
  const timeoutMs =
    options.timeoutMs ?? tool?.policy.timeoutMs ?? 30_000;
  const maxBytes =
    options.maxOutputBytes ?? tool?.policy.maxOutputBytes ?? 200_000;
  const cwd = getShellRoot();
  const classified = classifyCommand(options.command);

  if (classified.tier === "deny") {
    return {
      exitCode: null,
      stdout: "",
      stderr: `negado: ${classified.reasons.join(", ")}`,
      timedOut: false,
      cwd,
      classified,
    };
  }

  if (classified.tier === "confirm" && !options.approved) {
    return {
      exitCode: null,
      stdout: "",
      stderr: "needs_approval",
      timedOut: false,
      cwd,
      classified,
    };
  }

  let timedOut = false;
  try {
    let stdout = "";
    let stderr = "";
    const exitCode = 0;

    if (classified.tier === "auto") {
      const [bin, ...args] = classified.argv;
      const result = await execFileAsync(bin, args, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: maxBytes,
        env: { ...process.env, HOME: process.env.HOME },
      });
      stdout = result.stdout?.toString() ?? "";
      stderr = result.stderr?.toString() ?? "";
    } else {
      // Approved confirm path — allow pipes via login shell.
      const shell = process.env.SHELL || "/bin/zsh";
      const result = await execFileAsync(shell, ["-lc", classified.raw], {
        cwd,
        timeout: timeoutMs,
        maxBuffer: maxBytes,
        env: { ...process.env },
      });
      stdout = result.stdout?.toString() ?? "";
      stderr = result.stderr?.toString() ?? "";
    }

    return {
      exitCode,
      stdout: redactSecrets(truncate(stdout, maxBytes)),
      stderr: redactSecrets(truncate(stderr, maxBytes)),
      timedOut,
      cwd,
      classified,
    };
  } catch (err) {
    const e = err as {
      killed?: boolean;
      code?: number | string;
      signal?: string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    timedOut = Boolean(e.killed) || e.signal === "SIGTERM";
    const exitCode =
      typeof e.code === "number" ? e.code : timedOut ? null : 1;
    return {
      exitCode,
      stdout: redactSecrets(
        truncate((e.stdout?.toString() ?? ""), maxBytes),
      ),
      stderr: redactSecrets(
        truncate(
          e.stderr?.toString() || e.message || "erro de execução",
          maxBytes,
        ),
      ),
      timedOut,
      cwd,
      classified,
    };
  }
}
