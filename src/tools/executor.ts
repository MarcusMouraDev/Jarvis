import {
  addStep,
  finishRun,
  getApproval,
  requestApproval,
  startRun,
} from "@/core/run-ledger";
import { evaluatePolicy } from "@/core/policy-engine";
import type { PrivacyClass } from "@/core/types";
import { runBrowser } from "@/integrations/browser/run";
import { runMcpBrasilQuery } from "@/integrations/mcp-brasil/run";
import { getTool } from "./registry";
import { runShellCommand } from "./shell-run";

export function isToolExecutorEnabled(): boolean {
  return process.env.JARVIS_TOOL_EXECUTOR === "1";
}

export interface ToolExecuteInput {
  toolId: string;
  input: Record<string, unknown>;
  profileId: string;
  privacyClass: PrivacyClass;
  approvalId?: string;
}

export type ToolExecuteResult =
  | { status: "ok"; runId: string; output: unknown }
  | { status: "needs_approval"; runId: string; approvalId: string }
  | { status: "denied"; runId: string; reason: string };

function runKindForTool(toolId: string) {
  if (toolId === "browser.run") return "browser" as const;
  if (toolId.startsWith("mcp_brasil.")) return "mcp" as const;
  return "shell" as const;
}

export async function executeTool(
  options: ToolExecuteInput,
): Promise<ToolExecuteResult> {
  if (!isToolExecutorEnabled()) {
    return { status: "denied", runId: "", reason: "executor_disabled" };
  }

  const tool = getTool(options.toolId);
  if (!tool) {
    return { status: "denied", runId: "", reason: "tool_not_found" };
  }

  const decision = evaluatePolicy({
    profileId: options.profileId,
    privacyClass: options.privacyClass,
    toolId: options.toolId,
    risk: tool.risk,
  });

  if (!decision.allowed) {
    const run = startRun({
      kind: runKindForTool(options.toolId),
      summary: `${options.toolId} denied`,
    });
    finishRun(run.id, "denied", { summary: decision.reason });
    return { status: "denied", runId: run.id, reason: decision.reason ?? "denied" };
  }

  const run = startRun({
    kind: runKindForTool(options.toolId),
    summary: options.toolId,
  });
  addStep(run.id, "tool", options.toolId);

  if (decision.needsApproval && !options.approvalId) {
    const approval = requestApproval({
      runId: run.id,
      action: options.toolId,
      scope: options.toolId,
      reasons: ["risk_tier_confirm"],
    });
    finishRun(run.id, "needs_approval");
    return {
      status: "needs_approval",
      runId: run.id,
      approvalId: approval.id,
    };
  }

  if (decision.needsApproval && options.approvalId) {
    const approval = getApproval(options.approvalId);
    if (!approval || approval.decision === "denied") {
      finishRun(run.id, "denied", { summary: "approval_denied" });
      return { status: "denied", runId: run.id, reason: "approval_denied" };
    }
    addStep(run.id, "approval", options.approvalId);
  }

  try {
    const parsed = tool.inputSchema.parse(options.input);

    if (options.toolId === "shell.run") {
      const shellInput = parsed as { command: string; timeoutMs?: number };
      const result = await runShellCommand({
        command: shellInput.command,
        approved: true,
        timeoutMs: shellInput.timeoutMs,
      });
      addStep(
        run.id,
        "exit",
        `code=${result.exitCode} timedOut=${result.timedOut}`,
      );
      finishRun(run.id, result.exitCode === 0 ? "ok" : "error", {
        summary: result.stderr || undefined,
      });
      return { status: "ok", runId: run.id, output: result };
    }

    if (options.toolId === "mcp_brasil.query") {
      const result = await runMcpBrasilQuery(parsed);
      if (result.status === "denied") {
        finishRun(run.id, "denied", { summary: result.reason });
        return { status: "denied", runId: run.id, reason: result.reason };
      }
      addStep(run.id, "source", result.output.source);
      finishRun(run.id, "ok");
      return { status: "ok", runId: run.id, output: result.output };
    }

    if (options.toolId === "browser.run") {
      const browserInput = {
        ...(parsed as Record<string, unknown>),
        approvalId: options.approvalId,
      };
      const result = await runBrowser(browserInput, { runId: run.id });
      if (result.status === "needs_approval") {
        finishRun(run.id, "needs_approval");
        return {
          status: "needs_approval",
          runId: run.id,
          approvalId: result.approvalId,
        };
      }
      if (result.status === "denied") {
        finishRun(run.id, "denied", { summary: result.reason });
        return { status: "denied", runId: run.id, reason: result.reason };
      }
      addStep(run.id, "browser", `steps=${result.output.results.length}`);
      finishRun(run.id, "ok");
      return { status: "ok", runId: run.id, output: result.output };
    }

    finishRun(run.id, "error", { summary: "tool_not_implemented" });
    return { status: "denied", runId: run.id, reason: "tool_not_implemented" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "tool_error";
    finishRun(run.id, "error", { summary: message });
    return { status: "denied", runId: run.id, reason: message };
  }
}
