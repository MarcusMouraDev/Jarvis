"use client";

import { useState } from "react";
import { safeCoreFetch } from "@/lib/safe-core-client";

export function SubagentRail({
  runId,
  subagents,
}: {
  runId: string | null;
  subagents: ReadonlyArray<{ id: string; name: string; status: "running" | "done" }>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!runId || subagents.length === 0) return null;

  return (
    <div className="ambiente-block" aria-label="Subagents">
      <p className="ambiente-kicker">subagents</p>
      <ul className="ambiente-sessions">
        {subagents.map((item) => (
          <li key={item.id}>
            <span>
              {item.name} · {item.status}
            </span>
            {item.status === "running" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void safeCoreFetch("/api/hermes/control", {
                    method: "POST",
                    body: JSON.stringify({
                      kind: "interrupt-subagent",
                      runId,
                      subagentId: item.id,
                    }),
                  }).finally(() => setBusy(false));
                }}
              >
                parar
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="ambiente-form"
        onSubmit={(event) => {
          event.preventDefault();
          const target = subagents.find((item) => item.status === "running");
          if (!target || !text.trim()) return;
          setBusy(true);
          void safeCoreFetch("/api/hermes/control", {
            method: "POST",
            body: JSON.stringify({
              kind: "steer",
              runId,
              subagentId: target.id,
              text,
            }),
          }).finally(() => setBusy(false));
          setText("");
        }}
      >
        <input
          aria-label="steer"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="steer"
        />
        <button type="submit" disabled={busy || !text.trim()}>
          enviar
        </button>
      </form>
    </div>
  );
}
