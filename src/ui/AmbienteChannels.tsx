"use client";

import { useCallback, useEffect, useState } from "react";
import { safeCoreFetch } from "@/lib/safe-core-client";
import type { MessagingPlatformView } from "@/integrations/hermes/channels";

export function AmbienteChannels() {
  const [platforms, setPlatforms] = useState<MessagingPlatformView[]>([]);
  const [dashboardUrl, setDashboardUrl] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [envDraft, setEnvDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await safeCoreFetch("/api/hermes/channels");
    if (!response.ok) return;
    const body = (await response.json()) as {
      platforms?: MessagingPlatformView[];
      dashboardUrl?: string;
    };
    setPlatforms(body.platforms ?? []);
    setDashboardUrl(body.dashboardUrl ?? "");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh synchronizes remote state.
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      setBusy(true);
      try {
        await safeCoreFetch("/api/hermes/channels", {
          method: "POST",
          body: JSON.stringify({ id, ...payload }),
        });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const current = platforms.find((platform) => platform.id === selected);

  return (
    <details className="ambiente-block">
      <summary>canais</summary>
      <ul className="ambiente-pips">
        {platforms.map((platform) => (
          <li key={platform.id}>
            <button
              type="button"
              className="ambiente-pip"
              data-state={platform.state === "connected" ? "ok" : "off"}
              onClick={() => setSelected(platform.id)}
            >
              <span aria-hidden />
              <b>{platform.id}</b>
            </button>
          </li>
        ))}
      </ul>
      {current ? (
        <form
          className="ambiente-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(current.id, { enabled: true, env: envDraft });
            setEnvDraft({});
          }}
        >
          <p className="ambiente-kicker">
            {current.name} · {current.state}
          </p>
          {(current.env_vars ?? [])
            .filter((field) => !field.is_set || field.is_password)
            .slice(0, 4)
            .map((field) => (
              <input
                key={field.key}
                aria-label={field.key}
                type={field.is_password ? "password" : "text"}
                placeholder={field.prompt || field.key}
                value={envDraft[field.key] ?? ""}
                onChange={(event) =>
                  setEnvDraft((draft) => ({ ...draft, [field.key]: event.target.value }))
                }
              />
            ))}
          <button type="submit" disabled={busy}>
            ligar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(current.id, { enabled: !current.enabled })}
          >
            {current.enabled ? "desligar" : "ativar"}
          </button>
        </form>
      ) : null}
      {dashboardUrl ? (
        <a className="ambiente-link" href={dashboardUrl} target="_blank" rel="noreferrer">
          dashboard Hermes
        </a>
      ) : null}
    </details>
  );
}
