import { z } from "zod";
import {
  addStep,
  decideApproval,
  finishRun,
  getApproval,
  requestApproval,
  startRun,
} from "@/core/run-ledger";
import { classifyCommand } from "@/tools/shell-policy";
import { runShellCommand } from "@/tools/shell-run";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";

export const runtime = "nodejs";

const bodySchema = z.object({
  command: z.string().min(1).max(4000),
  approvalId: z.string().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  if (isSafeAgentCoreEnabled()) {
    return Response.json(
      { error: "legacy_executor_disabled" },
      { status: 410 },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const classified = classifyCommand(parsed.command);
  const run = startRun({
    kind: "shell",
    summary: parsed.command,
  });
  addStep(run.id, "classify", `${classified.tier}: ${classified.reasons.join(", ") || "ok"}`);

  if (classified.tier === "deny") {
    finishRun(run.id, "denied", { summary: classified.reasons.join(", ") });
    return new Response(
      sse({
        type: "error",
        error: `negado: ${classified.reasons.join(", ")}`,
        classified,
        runId: run.id,
      }) + sse({ type: "exit", exitCode: null, runId: run.id }),
      {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      },
    );
  }

  let approved = classified.tier === "auto";

  if (classified.tier === "confirm") {
    if (!parsed.approvalId) {
      const approval = requestApproval({
        runId: run.id,
        action: parsed.command,
        scope: "shell.run",
        reasons: classified.reasons,
      });
      finishRun(run.id, "needs_approval", {
        summary: classified.reasons.join(", "),
      });
      return new Response(
        JSON.stringify({
          type: "needs_approval",
          approvalId: approval.id,
          runId: run.id,
          classified,
          cwd: process.env.JARVIS_SHELL_ROOT || process.cwd(),
          timeoutMs: parsed.timeoutMs ?? 30_000,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const approval = getApproval(parsed.approvalId);
    if (!approval || approval.decision === "denied") {
      finishRun(run.id, "denied");
      return new Response(JSON.stringify({ error: "approval_denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (approval.decision === "pending") {
      decideApproval(parsed.approvalId, "approved");
    }
    approved = true;
    addStep(run.id, "approval", `approved ${parsed.approvalId}`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (payload: unknown) =>
        controller.enqueue(enc.encode(sse(payload)));

      try {
        send({ type: "classified", classified, runId: run.id });
        const started = performance.now();
        const result = await runShellCommand({
          command: parsed.command,
          approved,
          timeoutMs: parsed.timeoutMs,
        });

        if (result.stdout) send({ type: "stdout", text: result.stdout });
        if (result.stderr && result.stderr !== "needs_approval") {
          send({ type: "stderr", text: result.stderr });
        }

        addStep(
          run.id,
          "exit",
          `code=${result.exitCode} timedOut=${result.timedOut}`,
        );
        finishRun(run.id, result.timedOut ? "error" : result.exitCode === 0 ? "ok" : "error", {
          latencyMs: Math.round(performance.now() - started),
        });

        send({
          type: "exit",
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          cwd: result.cwd,
          runId: run.id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "shell_error";
        finishRun(run.id, "error", { summary: message });
        send({ type: "error", error: message, runId: run.id });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
