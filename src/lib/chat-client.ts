export interface ChatStreamHandlers {
  onChunk?: (text: string) => void;
  onRoute?: (route: {
    requestedAlias: string;
    effectiveAlias: string;
    fallbackUsed: boolean;
    fallbackReason?: string;
    mode: "live" | "mock";
  }) => void;
  onSkills?: (skills: Array<{ name: string; source: string }>) => void;
  onDone?: (response: {
    text: string;
    model: string;
    provider: string;
    requestId: string;
    fallbackUsed: boolean;
    fallbackReason?: string;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
    };
  }) => void;
  onError?: (error: string) => void;
}

export async function streamChat(
  body: {
    alias: string;
    prompt: string;
    privacyClass?: string;
    skills?: string[];
    autoSelectSkills?: boolean;
    forceFallback?: boolean;
  },
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    handlers.onError?.(text || `http_${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        const evt = JSON.parse(payload) as {
          type: string;
          text?: string;
          error?: string;
          skills?: Array<{ name: string; source: string }>;
          requestedAlias?: string;
          effectiveAlias?: string;
          fallbackUsed?: boolean;
          fallbackReason?: string;
          mode?: "live" | "mock";
          response?: ChatStreamHandlers extends never ? never : {
            text: string;
            model: string;
            provider: string;
            requestId: string;
            fallbackUsed: boolean;
            fallbackReason?: string;
            usage: {
              promptTokens: number;
              completionTokens: number;
              totalTokens: number;
              estimatedCostUsd: number;
            };
          };
        };

        if (evt.type === "chunk" && evt.text) handlers.onChunk?.(evt.text);
        if (evt.type === "skills" && evt.skills) handlers.onSkills?.(evt.skills);
        if (evt.type === "route") {
          handlers.onRoute?.({
            requestedAlias: evt.requestedAlias ?? "",
            effectiveAlias: evt.effectiveAlias ?? "",
            fallbackUsed: Boolean(evt.fallbackUsed),
            fallbackReason: evt.fallbackReason,
            mode: evt.mode ?? "mock",
          });
        }
        if (evt.type === "done" && evt.response) handlers.onDone?.(evt.response);
        if (evt.type === "error" && evt.error) handlers.onError?.(evt.error);
      } catch {
        // ignore bad events
      }
    }
  }
}
