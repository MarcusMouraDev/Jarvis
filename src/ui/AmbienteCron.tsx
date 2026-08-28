"use client";

import { useCallback, useEffect, useState } from "react";
import { safeCoreFetch } from "@/lib/safe-core-client";
import type { CronJobView } from "@/integrations/hermes/cron";

export function AmbienteCron() {
  const [jobs, setJobs] = useState<CronJobView[]>([]);
  const [name, setName] = useState("diario");
  const [schedule, setSchedule] = useState("0 8 * * *");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await safeCoreFetch("/api/hermes/cron");
    if (!response.ok) return;
    const body = (await response.json()) as { jobs?: CronJobView[] };
    setJobs(body.jobs ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh synchronizes remote state.
    void refresh();
  }, [refresh]);

  const post = useCallback(
    async (body: Record<string, string>) => {
      setBusy(true);
      try {
        await safeCoreFetch("/api/hermes/cron", {
          method: "POST",
          body: JSON.stringify(body),
        });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return (
    <details className="ambiente-block">
      <summary>cron</summary>
      <ul className="ambiente-sessions">
        {jobs.slice(0, 8).map((job) => {
          const id = String(job.id ?? job.name ?? "");
          return (
            <li key={id}>
              <span>{String(job.name ?? id)}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void post({
                    action: job.paused || job.enabled === false ? "resume" : "pause",
                    name: id,
                  })
                }
              >
                {job.paused || job.enabled === false ? "retomar" : "pausar"}
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="ambiente-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!prompt.trim()) return;
          void post({ action: "add", name, schedule, prompt });
          setPrompt("");
        }}
      >
        <input
          aria-label="nome do cron"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          aria-label="schedule"
          value={schedule}
          onChange={(event) => setSchedule(event.target.value)}
        />
        <input
          aria-label="prompt do cron"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="prompt"
        />
        <button type="submit" disabled={busy || !prompt.trim()}>
          criar
        </button>
      </form>
    </details>
  );
}
