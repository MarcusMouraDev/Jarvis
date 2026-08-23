import { describe, expect, it } from "vitest";
import { compressToolOutput } from "./context-compression";

function bigStdout(lines: number): string {
  return Array.from({ length: lines }, () => "same repeated content").join("\n");
}

describe("context-compression", () => {
  it("leaves small terminal output untouched", () => {
    const raw = {
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
      timedOut: false,
    };
    const result = compressToolOutput("terminal.read", raw, { enabled: true });
    expect(result.output).toEqual(raw);
    expect(result.meta.engine).toBe("none");
    expect(result.meta.optedOut).toBe(false);
  });

  it("applies rtk-lite to large terminal streams and preserves exitCode/paths", () => {
    const pathLine = "src/core/tool-gateway.ts:42: error";
    const raw = {
      exitCode: 1,
      stdout: `${bigStdout(400)}\n${pathLine}\n`,
      stderr: Array.from({ length: 80 }, (_, i) => `  at frame${i} (x.js:1:1)`).join(
        "\n",
      ),
      timedOut: false,
    };
    const result = compressToolOutput("terminal.run", raw, {
      enabled: true,
      thresholdBytes: 100,
    });
    expect(result.meta.engine).toBe("rtk-lite");
    expect(result.meta.sentBytes).toBeLessThan(result.meta.originalBytes);
    expect(result.output).toMatchObject({ exitCode: 1, timedOut: false });
    const out = result.output as { stdout: string; stderr: string };
    expect(out.stdout).toContain(pathLine);
    expect(out.stdout).toContain("identical lines omitted");
    expect(out.stderr).toContain("stack frames omitted");
  });

  it("never compresses file.patch diffs", () => {
    const raw = {
      applied: true,
      paths: ["a.ts"],
      diff: "x".repeat(8_000),
    };
    const result = compressToolOutput("file.patch", raw, {
      enabled: true,
      thresholdBytes: 10,
    });
    expect(result.output).toEqual(raw);
    expect(result.meta.engine).toBe("none");
  });

  it("honors JARVIS_CONTEXT_COMPRESSION=0 opt-out", () => {
    const raw = {
      exitCode: 0,
      stdout: bigStdout(500),
      stderr: "",
      timedOut: false,
    };
    const result = compressToolOutput("terminal.read", raw, { enabled: false });
    expect(result.meta.optedOut).toBe(true);
    expect(result.meta.engine).toBe("none");
    expect(result.output).toEqual(raw);
  });
});
