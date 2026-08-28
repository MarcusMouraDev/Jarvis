import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

function hermesBin(): string {
  return (
    process.env.HERMES_BIN?.trim() ||
    join(homedir(), ".hermes", "venvs", "hermes-313", "bin", "hermes")
  );
}

function hermesPython(): string {
  return join(homedir(), ".hermes", "venvs", "hermes-313", "bin", "python");
}

export interface ComputerUseStatus {
  installed: boolean;
  binary?: string;
  detail?: string;
  captureBeforeClick: boolean;
  tccAccessibility: boolean | null;
  tccScreenRecording: boolean | null;
}

function probeTcc(): Pick<ComputerUseStatus, "tccAccessibility" | "tccScreenRecording"> {
  const script = `
import json
out = {"accessibility": None, "screen": None}
try:
    from ApplicationServices import AXIsProcessTrusted
    out["accessibility"] = bool(AXIsProcessTrusted())
except Exception:
    try:
        from Quartz import AXIsProcessTrusted
        out["accessibility"] = bool(AXIsProcessTrusted())
    except Exception:
        pass
try:
    import Quartz
    fn = getattr(Quartz, "CGPreflightScreenCaptureAccess", None)
    if callable(fn):
        out["screen"] = bool(fn())
except Exception:
    pass
print(json.dumps(out))
`;
  const result = spawnSync(hermesPython(), ["-c", script], {
    encoding: "utf8",
    timeout: 8_000,
  });
  try {
    const parsed = JSON.parse(result.stdout || "{}") as {
      accessibility?: boolean | null;
      screen?: boolean | null;
    };
    return {
      tccAccessibility: parsed.accessibility ?? null,
      tccScreenRecording: parsed.screen ?? null,
    };
  } catch {
    return { tccAccessibility: null, tccScreenRecording: null };
  }
}

export function probeComputerUse(): ComputerUseStatus {
  const tcc = probeTcc();
  const which = spawnSync("command", ["-v", "cua-driver"], {
    encoding: "utf8",
    shell: true,
  });
  const binary = which.stdout.trim();
  if (binary) {
    return {
      installed: true,
      binary,
      captureBeforeClick: true,
      ...tcc,
    };
  }
  const status = spawnSync(/* turbopackIgnore: true */ hermesBin(), ["computer-use", "status"], {
    encoding: "utf8",
    env: { ...process.env, HERMES_HOME: process.env.HERMES_HOME },
    timeout: 15_000,
  });
  const output = `${status.stdout}\n${status.stderr}`;
  const installed = status.status === 0 && /installed|ready|ok/i.test(output);
  return {
    installed,
    detail: output.trim().slice(0, 400) || undefined,
    captureBeforeClick: true,
    ...tcc,
  };
}

export function installComputerUse(): ComputerUseStatus {
  const result = spawnSync(/* turbopackIgnore: true */ hermesBin(), ["computer-use", "install"], {
    encoding: "utf8",
    env: { ...process.env, HERMES_HOME: process.env.HERMES_HOME },
    timeout: 180_000,
  });
  if (result.status !== 0) {
    return {
      installed: false,
      detail: `${result.stdout}\n${result.stderr}`.trim().slice(0, 600),
      captureBeforeClick: true,
      tccAccessibility: null,
      tccScreenRecording: null,
    };
  }
  return probeComputerUse();
}
