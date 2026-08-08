import type { TextAdapter } from "./base";
import { CursorTextAdapter } from "./cursor";
import { GeminiTextAdapter } from "./gemini";
import { MockTextAdapter } from "./mock-text";
import {
  OpenAICompatibleTextAdapter,
  isOpenAICompatibleConfigured,
} from "./openai-compatible";
import type { MockFailure } from "./base";
import { getModelConfig } from "@/core/config";
import { hasEnv } from "@/lib/env";

export function isModelAliasAvailable(alias: string): boolean {
  const config = getModelConfig(alias);
  if (!config) return false;

  if (config.adapter === "openai-compatible") {
    return isOpenAICompatibleConfigured();
  }
  if (alias === "gemini") return hasEnv("GEMINI_API_KEY");
  if (alias === "codex") return hasEnv("CURSOR_API_KEY");
  return true;
}

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

  const config = getModelConfig(alias);

  if (config?.adapter === "openai-compatible") {
    if (isOpenAICompatibleConfigured()) {
      return {
        adapter: new OpenAICompatibleTextAdapter(alias),
        mode: "live",
      };
    }
    return {
      adapter: new MockTextAdapter(
        alias,
        "unavailable",
        options?.fallbackUsed,
        options?.fallbackReason,
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
