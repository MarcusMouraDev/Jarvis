import type { TextAdapter } from "./base";
import type { TextRequest, TextResponse } from "@/core/types";
import { cursorAgentCwd, cursorModelId, requireEnv } from "@/lib/env";

/**
 * Cursor SDK adapter for the `codex` alias.
 * Runs a local Cursor agent against CURSOR_AGENT_CWD (defaults to project root).
 */
export class CursorTextAdapter implements TextAdapter {
  constructor(private readonly alias = "codex") {}

  async *stream(
    request: TextRequest,
    options?: { systemInstruction?: string },
  ): AsyncGenerator<string, TextResponse> {
    const apiKey = requireEnv("CURSOR_API_KEY");
    const cursorSdk = await import("@cursor/sdk");
    const Agent = cursorSdk.Agent;

    const prompt = options?.systemInstruction
      ? `${options.systemInstruction}\n\n---\n\nPedido do usuário:\n${request.prompt}`
      : request.prompt;

    let full = "";
    try {
      await using agent = await Agent.create({
        apiKey,
        model: { id: cursorModelId() },
        local: { cwd: cursorAgentCwd() },
      });

      const run = await agent.send(prompt);
      for await (const event of run.stream()) {
        if (event.type === "assistant") {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              full += block.text;
              yield block.text;
            }
          }
        }
      }

      const result = await run.wait();
      if (result.status === "error") {
        throw new Error("unavailable");
      }
      if (result.result && !full) {
        full = String(result.result);
        yield full;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "cursor_error";
      if (
        err instanceof Error &&
        (err.name === "CursorAgentError" || "isRetryable" in err)
      ) {
        throw new Error(`cursor_error:${message}`);
      }
      throw err;
    }

    return {
      provider: "openai",
      model: this.alias,
      requestId: request.requestId,
      fallbackUsed: false,
      requestedAlias: request.model,
      usage: {
        promptTokens: Math.ceil(request.prompt.length / 4),
        completionTokens: Math.ceil(full.length / 4),
        totalTokens: Math.ceil((request.prompt.length + full.length) / 4),
        estimatedCostUsd: 0,
      },
      text: full,
    };
  }
}
