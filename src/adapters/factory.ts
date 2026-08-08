import type { TextAdapter } from "./base";
import { CursorTextAdapter } from "./cursor";
import { GeminiTextAdapter } from "./gemini";
import { MockTextAdapter } from "./mock-text";
import type { MockFailure } from "./base";
import { hasEnv } from "@/lib/env";

export function createTextAdapter(
  alias: string,
  options?: {
    failure?: MockFailure;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    forceMock?: boolean;
  },
): { adapter: TextAdapter; mode: "live" | "mock" } {
  if (options?.forceMock) {
    return {
      adapter: new MockTextAdapter(
        alias,
        options.failure ?? "none",
        options.fallbackUsed,
        options.fallbackReason,
      ),
      mode: "mock",
    };
  }

  if (alias === "gemini" && hasEnv("GEMINI_API_KEY")) {
    return { adapter: new GeminiTextAdapter("gemini"), mode: "live" };
  }

  if (alias === "codex" && hasEnv("CURSOR_API_KEY")) {
    return { adapter: new CursorTextAdapter("codex"), mode: "live" };
  }

  // deepseek aliases stay mock until DEEPSEEK adapter is wired
  return {
    adapter: new MockTextAdapter(
      alias,
      options?.failure ?? "none",
      options?.fallbackUsed,
      options?.fallbackReason,
    ),
    mode: "mock",
  };
}
