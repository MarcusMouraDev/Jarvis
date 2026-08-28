import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probeComputerUse } from "./computer-use";

describe("probeComputerUse", () => {
  it("documents capture-before-click as a required contract", () => {
    const status = probeComputerUse();
    expect(status.captureBeforeClick).toBe(true);
    expect("tccAccessibility" in status).toBe(true);
    expect("tccScreenRecording" in status).toBe(true);
  });

  it("hermes click refuses work without a prior capture", () => {
    const path = join(
      homedir(),
      "Projetos",
      "hermes-agent",
      "tools",
      "computer_use",
      "cua_backend.py",
    );
    if (!existsSync(path)) return;
    const src = readFileSync(path, "utf8");
    expect(src).toContain("call capture() first");
  });
});
