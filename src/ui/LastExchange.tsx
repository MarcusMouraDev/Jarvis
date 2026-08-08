import type { ChatMessage } from "./HistoryPanel";

interface LastExchangeProps {
  messages: ChatMessage[];
}

export function LastExchange({ messages }: LastExchangeProps) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastReply = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" || m.role === "system");

  if (!lastUser && !lastReply) return null;

  const replyLabel =
    lastReply?.role === "system" ? "sistema" : "jarvis";

  return (
    <section
      className="response-zone mx-auto mt-3 w-full max-w-[65ch] px-1 text-center"
      aria-label="Resposta"
      aria-live="polite"
    >
      {lastUser ? (
        <p className="mb-2 line-clamp-2 text-xs text-ink-2 sm:text-sm">
          <span className="font-mono text-[10px] uppercase tracking-wide text-ink-2/80">
            você ·{" "}
          </span>
          {lastUser.text}
        </p>
      ) : null}
      {lastReply ? (
        <div
          key={lastReply.id}
          className="response-reveal text-pretty text-base leading-relaxed text-ink-0 sm:text-[1.05rem]"
        >
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-ink-2">
            {replyLabel}
          </p>
          <p className="whitespace-pre-wrap">{lastReply.text}</p>
          {lastReply.meta ? (
            <p className="mt-2 font-mono text-[10px] text-ink-2">
              {lastReply.meta}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
