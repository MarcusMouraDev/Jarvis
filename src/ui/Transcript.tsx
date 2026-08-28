"use client";

import type { ChatMessage } from "./HistoryPanel";
import { Markdown } from "./Markdown";

interface TranscriptProps {
  messages: ChatMessage[];
}

export function Transcript({ messages }: TranscriptProps) {
  return (
    <section
      className="transcript mx-auto mt-3 w-full max-w-[76ch] px-1 text-left"
      aria-label="Transcrição"
      aria-live="polite"
    >
      {messages.map((message) => {
        const label =
          message.role === "user"
            ? "você"
            : message.role === "system"
              ? "sistema"
              : "hermes";
        return (
          <article
            key={message.id}
            className="transcript-turn relative mb-4 border-l border-surface-2/80 pl-3"
            data-role={message.role}
          >
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-ink-2">
              {label}
            </p>
            {message.role === "assistant" ? (
              <Markdown>{message.text}</Markdown>
            ) : (
              <p className="text-pretty text-sm leading-relaxed text-ink-1">{message.text}</p>
            )}
            {message.meta ? (
              <p className="mt-2 font-mono text-[10px] text-ink-2">{message.meta}</p>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
