export interface ClassifiedPayload {
  tier: "auto" | "confirm" | "deny";
  raw: string;
  argv: string[];
  reasons: string[];
  bin: string;
}

export interface ShellStreamHandlers {
  onClassified?: (c: ClassifiedPayload) => void;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  onExit?: (payload: {
    exitCode: number | null;
    timedOut?: boolean;
    cwd?: string;
    runId?: string;
  }) => void;
  onError?: (error: string) => void;
  onNeedsApproval?: (payload: {
    approvalId: string;
    runId: string;
    classified: ClassifiedPayload;
    cwd: string;
    timeoutMs: number;
  }) => void;
}

export async function streamShell(
  body: { command: string; approvalId?: string; timeoutMs?: number },
  handlers: ShellStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/tools/shell", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await res.json()) as {
      type?: string;
      error?: string;
      approvalId?: string;
      runId?: string;
      classified?: ClassifiedPayload;
      cwd?: string;
      timeoutMs?: number;
    };
    if (data.type === "needs_approval" && data.approvalId && data.classified) {
      handlers.onNeedsApproval?.({
        approvalId: data.approvalId,
        runId: data.runId ?? "",
        classified: data.classified,
        cwd: data.cwd ?? "",
        timeoutMs: data.timeoutMs ?? 30_000,
      });
      return;
    }
    handlers.onError?.(data.error ?? `http_${res.status}`);
    return;
  }

  if (!res.ok || !res.body) {
    handlers.onError?.(await res.text().catch(() => `http_${res.status}`));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part
        .split("\n")
        .find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const payload = JSON.parse(line.slice(6)) as {
          type: string;
          classified?: ClassifiedPayload;
          text?: string;
          error?: string;
          exitCode?: number | null;
          timedOut?: boolean;
          cwd?: string;
          runId?: string;
        };
        if (payload.type === "classified" && payload.classified) {
          handlers.onClassified?.(payload.classified);
        } else if (payload.type === "stdout" && payload.text) {
          handlers.onStdout?.(payload.text);
        } else if (payload.type === "stderr" && payload.text) {
          handlers.onStderr?.(payload.text);
        } else if (payload.type === "exit") {
          handlers.onExit?.({
            exitCode: payload.exitCode ?? null,
            timedOut: payload.timedOut,
            cwd: payload.cwd,
            runId: payload.runId,
          });
        } else if (payload.type === "error") {
          handlers.onError?.(payload.error ?? "shell_error");
        }
      } catch {
        // ignore malformed SSE
      }
    }
  }
}

export async function decideShellApproval(
  approvalId: string,
  decision: "approved" | "denied",
): Promise<void> {
  await fetch("/api/tools/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalId, decision }),
  });
}
