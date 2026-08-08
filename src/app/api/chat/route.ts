import { z } from "zod";
import { formatContextBlocks } from "@/context/format-context";
import { routeTextRequest } from "@/core/router";
import { isMemoryEnabled } from "@/memory/flags";
import {
  formatMemoriesForSystemPrompt,
  getMemoriesByIds,
  recallConsented,
} from "@/memory/memory-service";
import {
  addStep,
  finishRun,
  startRun,
} from "@/core/run-ledger";
import { recordTelemetry } from "@/core/telemetry";
import {
  formatSkillsForSystemPrompt,
  selectSkillsForPrompt,
} from "@/skills/catalog";

export const runtime = "nodejs";

const contextBlockSchema = z.object({
  relPath: z.string(),
  absPath: z.string().optional(),
  hash: z.string(),
  byteSize: z.number(),
  lineCount: z.number(),
  language: z.string(),
  exports: z.array(z.string()),
  imports: z.array(z.string()),
  symbols: z.array(z.string()),
  excerpt: z.string().max(2000),
});

const bodySchema = z.object({
  alias: z.string().default("gemini"),
  prompt: z.string().min(1),
  privacyClass: z
    .enum(["public", "internal", "confidential", "secret"])
    .default("internal"),
  skills: z.array(z.string()).optional(),
  autoSelectSkills: z.boolean().default(true),
  forceFallback: z.boolean().optional(),
  forceMock: z.boolean().optional(),
  contextBlocks: z.array(contextBlockSchema).max(6).optional(),
  profile: z.string().optional(),
  memoryIds: z.array(z.string()).optional(),
  confirmedCloudFallback: z.boolean().optional(),
});

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (parsed.privacyClass === "secret") {
    return new Response(JSON.stringify({ error: "privacy_blocked" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const selected = selectSkillsForPrompt(parsed.prompt, {
    names: parsed.skills,
    limit: parsed.autoSelectSkills || parsed.skills?.length ? 4 : 0,
  });
  const contextText = formatContextBlocks(parsed.contextBlocks ?? []);

  const recalled = new Map<string, ReturnType<typeof recallConsented>[number]>();
  let memoryText = "";
  if (isMemoryEnabled()) {
    if (parsed.memoryIds?.length) {
      for (const memory of getMemoriesByIds(parsed.memoryIds)) {
        recalled.set(memory.id, memory);
      }
    }
    for (const memory of recallConsented(parsed.prompt)) {
      recalled.set(memory.id, memory);
    }
    const memories = [...recalled.values()];
    if (memories.length) {
      memoryText = formatMemoriesForSystemPrompt(memories);
    }
  }

  const systemInstruction = [
    "Você é o Jarvis V23. Nunca mascare troca de modelo ou fallback.",
    "Responda em português do Brasil salvo pedido contrário.",
    formatSkillsForSystemPrompt(selected),
    contextText,
    memoryText,
  ]
    .filter(Boolean)
    .join("\n\n");

  const started = performance.now();
  const ledgerRun = startRun({
    kind: "chat",
    alias: parsed.alias,
    summary: parsed.prompt.slice(0, 200),
  });
  if (selected.length) {
    addStep(
      ledgerRun.id,
      "skills",
      selected.map((s) => s.name).join(", "),
    );
  }
  if (parsed.contextBlocks?.length) {
    addStep(
      ledgerRun.id,
      "context",
      parsed.contextBlocks.map((b) => `${b.relPath}#${b.hash}`).join(", "),
    );
  }
  if (parsed.profile) {
    addStep(ledgerRun.id, "profile", parsed.profile);
  }
  if (recalled.size) {
    addStep(
      ledgerRun.id,
      "memory.recall",
      [...recalled.keys()].join(", "),
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (payload: unknown) =>
        controller.enqueue(enc.encode(sse(payload)));

      try {
        send({
          type: "skills",
          skills: selected.map((s) => ({
            name: s.name,
            source: s.source,
          })),
        });

        let { request, route } = await routeTextRequest(
          parsed.alias,
          parsed.prompt,
          {
            privacyClass: parsed.privacyClass,
            forceFallback: parsed.forceFallback,
            forceMock: parsed.forceMock,
            profileId: parsed.profile,
            confirmedCloudFallback: parsed.confirmedCloudFallback,
          },
        );

        if (route.cloudFallbackConsentRequired) {
          send({
            type: "consent_required",
            kind: "cloud_fallback",
            requestedAlias: route.requestedAlias,
            effectiveAlias: route.effectiveAlias,
            fallbackReason: route.fallbackReason,
            privacyClass: parsed.privacyClass,
          });
          finishRun(ledgerRun.id, "cancelled", {
            summary: "cloud_fallback_consent_required",
          });
          controller.close();
          return;
        }

        addStep(
          ledgerRun.id,
          "route",
          `${route.requestedAlias}→${route.effectiveAlias} (${route.mode})${
            route.smartRouteReason ? ` · ${route.smartRouteReason}` : ""
          }`,
        );

        send({
          type: "route",
          requestedAlias: route.requestedAlias,
          effectiveAlias: route.effectiveAlias,
          routedAlias: route.routedAlias,
          fallbackUsed: route.fallbackUsed,
          fallbackReason: route.fallbackReason,
          smartRouteReason: route.smartRouteReason,
          mode: route.mode,
        });

        try {
          const gen = route.adapter!.stream(request, { systemInstruction });
          let full = "";
          while (true) {
            const { value, done } = await gen.next();
            if (done) {
              const response = value;
              if (!response) throw new Error("Stream vazio");
              const latencyMs = performance.now() - started;
              recordTelemetry({
                requestId: response.requestId,
                alias: response.model,
                effectiveProvider: response.provider,
                latencyMs,
                status: response.fallbackUsed ? "fallback" : "ok",
                fallbackReason: response.fallbackReason,
                usage: response.usage,
              });
              finishRun(ledgerRun.id, "ok", {
                costUsd: response.usage.estimatedCostUsd,
                latencyMs: Math.round(latencyMs),
              });
              send({
                type: "done",
                response: {
                  ...response,
                  text: response.text || full,
                },
              });
              break;
            }
            full += value;
            send({ type: "chunk", text: value });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "error";
          const retryable =
            message === "rate_limit" ||
            message === "unavailable" ||
            message === "timeout" ||
            message.startsWith("gemini_error:429");

          if (retryable && !route.fallbackUsed) {
            const fallbackRoute = await routeTextRequest(parsed.alias, parsed.prompt, {
              privacyClass: parsed.privacyClass,
              forceFallback: true,
              forceMock: parsed.forceMock,
              profileId: parsed.profile,
              confirmedCloudFallback: parsed.confirmedCloudFallback,
            });
            if (fallbackRoute.route.fallbackUsed) {
              route = fallbackRoute.route;
              request = fallbackRoute.request;
              if (route.cloudFallbackConsentRequired) {
                send({
                  type: "consent_required",
                  kind: "cloud_fallback",
                  requestedAlias: route.requestedAlias,
                  effectiveAlias: route.effectiveAlias,
                  fallbackReason: route.fallbackReason,
                  privacyClass: parsed.privacyClass,
                });
                finishRun(ledgerRun.id, "cancelled", {
                  summary: "cloud_fallback_consent_required",
                });
                controller.close();
                return;
              }
              addStep(ledgerRun.id, "fallback", message);
              send({
                type: "route",
                requestedAlias: route.requestedAlias,
                effectiveAlias: route.effectiveAlias,
                routedAlias: route.routedAlias,
                fallbackUsed: true,
                fallbackReason: message,
                mode: route.mode,
              });

              const gen = route.adapter!.stream(request, { systemInstruction });
              while (true) {
                const { value, done } = await gen.next();
                if (done) {
                  const response = {
                    ...value!,
                    fallbackUsed: true,
                    fallbackReason: message,
                  };
                  finishRun(ledgerRun.id, "ok", {
                    costUsd: response.usage?.estimatedCostUsd,
                    latencyMs: Math.round(performance.now() - started),
                    summary: `fallback: ${message}`,
                  });
                  send({ type: "done", response });
                  break;
                }
                send({ type: "chunk", text: value });
              }
              controller.close();
              return;
            }
          }

          finishRun(ledgerRun.id, "error", { summary: message });
          send({ type: "error", error: message });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "error";
        finishRun(ledgerRun.id, "error", { summary: message });
        send({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
