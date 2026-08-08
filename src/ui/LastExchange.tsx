import type { ChatMessage } from "./HistoryPanel";

interface LastExchangeProps {
  messages: ChatMessage[];
}

export function LastExchange({ messages }: LastExchangeProps) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");

  if (!lastUser && !lastAssistant) return null;

  return (
    <div className="mx-auto mt-4 w-full max-w-xl space-y-2 text-center text-sm">
      {lastUser ? (
        <p className="line-clamp-2 text-ink-2">
          <span className="font-mono text-[10px] uppercase">você · </span>
          {lastUser.text}
        </p>
      ) : null}
      {lastAssistant ? (
        <p className="line-clamp-3 text-ink-1">
          <span className="font-mono text-[10px] uppercase">jarvis · </span>
          {lastAssistant.text}
        </p>
      ) : null}
    </div>
  );
}
