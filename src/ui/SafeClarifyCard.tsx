"use client";

import { useState } from "react";
import { safeCoreFetch } from "@/lib/safe-core-client";

export function SafeClarifyCard({
  runId,
  requestId,
  prompt,
  busy,
}: {
  runId: string;
  requestId: string;
  prompt: string;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  return (
    <form
      className="safe-approval-card elev-3 mx-auto mt-3 w-full max-w-md rounded-xl border border-surface-2 bg-surface-1 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim() || sending || busy) return;
        setSending(true);
        void safeCoreFetch("/api/hermes/control", {
          method: "POST",
          body: JSON.stringify({ kind: "clarify", runId, requestId, text }),
        }).finally(() => setSending(false));
        setText("");
      }}
    >
      <p className="text-sm text-accent-ask">{prompt || "Esclarecimento"}</p>
      <input
        className="mt-2 w-full bg-transparent text-sm"
        aria-label="resposta clarify"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" disabled={sending || busy || !text.trim()}>
        responder
      </button>
    </form>
  );
}
