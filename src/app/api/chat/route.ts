import { z } from "zod";
import { routeTextRequest } from "@/core/router";
import { recordTelemetry } from "@/core/telemetry";
import {
  formatSkillsForSystemPrompt,
  selectSkillsForPrompt,
} from "@/skills/catalog";

export const runtime = "nodejs";

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
  const systemInstruction = [
    "Você é o Jarvis V21. Nunca mascare troca de modelo ou fallback.",
    "Responda em português do Brasil salvo pedido contrário.",
    formatSkillsForSystemPrompt(selected),
  ]
    .filter(Boolean)
    .join("\n\n");

  const started = performance.now();
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
          },
        );

        send({
          type: "route",
          requestedAlias: route.requestedAlias,
          effectiveAlias: route.effectiveAlias,
          fallbackUsed: route.fallbackUsed,
          fallbackReason: route.fallbackReason,
          mode: route.mode,
        });

        try {
          const gen = route.adapter.stream(request, { systemInstruction });
          let full = "";
          while (true) {
            const { value, done } = await gen.next();
            if (done) {
              const response = value;
              if (!response) throw new Error("Stream vazio");
              recordTelemetry({
                requestId: response.requestId,
                alias: response.model,
                effectiveProvider: response.provider,
                latencyMs: performance.now() - started,
                status: response.fallbackUsed ? "fallback" : "ok",
                fallbackReason: response.fallbackReason,
                usage: response.usage,
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

          if (
            retryable &&
            !route.fallbackUsed &&
            parsed.alias !== route.effectiveAlias
          ) {
            // already on fallback path
          }

          if (retryable && !route.fallbackUsed) {
            const fallbackRoute = await routeTextRequest(parsed.alias, parsed.prompt, {
              privacyClass: parsed.privacyClass,
              forceFallback: true,
              forceMock: parsed.forceMock,
            });
            if (fallbackRoute.route.fallbackUsed) {
              route = fallbackRoute.route;
              request = fallbackRoute.request;
              send({
                type: "route",
                requestedAlias: route.requestedAlias,
                effectiveAlias: route.effectiveAlias,
                fallbackUsed: true,
                fallbackReason: message,
                mode: route.mode,
              });

              const gen = route.adapter.stream(request, { systemInstruction });
              while (true) {
                const { value, done } = await gen.next();
                if (done) {
                  const response = {
                    ...value!,
                    fallbackUsed: true,
                    fallbackReason: message,
                  };
                  send({ type: "done", response });
                  break;
                }
                send({ type: "chunk", text: value });
              }
              controller.close();
              return;
            }
          }

          send({ type: "error", error: message });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "error";
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
