"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Markdown } from "./Markdown";
import { HudMenu } from "./HudMenu";
import { safeCoreFetch } from "@/lib/safe-core-client";
import { AmbienteCron } from "./AmbienteCron";
import { AmbienteChannels } from "./AmbienteChannels";

interface LearningPayload {
  memory?: string;
  user?: string;
}

interface SkillsPayload {
  skills?: Array<{ name: string }>;
  knobs?: { memoryNudgeInterval?: number; backgroundReview?: boolean };
  curator?: unknown;
}

interface SessionPayload {
  sessions?: Array<{ id: string; title: string; updatedAt: string }>;
}

interface ComputerUsePayload {
  installed?: boolean;
  detail?: string;
  captureBeforeClick?: boolean;
  tccAccessibility?: boolean | null;
  tccScreenRecording?: boolean | null;
}

function triState(value: boolean | null | undefined): "ok" | "off" | "unknown" {
  if (value == null) return "unknown";
  return value ? "ok" : "off";
}

function firstLine(text: string): string {
  const line = text
    .split("\n")
    .map((row) => row.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  if (!line) return "";
  return line.length > 42 ? `${line.slice(0, 41)}…` : line;
}

function SlotNote({
  label,
  empty,
  children,
}: {
  label: string;
  empty: string;
  children: string;
}) {
  const filled = Boolean(children.trim());
  const preview = filled ? firstLine(children) : empty;
  return (
    <div className="ambiente-note-row" data-filled={filled ? "true" : "false"}>
      {filled ? (
        <details>
          <summary>
            <span>{label}</span>
            <em>{preview}</em>
          </summary>
          <div className="ambiente-note-row__body">
            <Markdown>{children}</Markdown>
          </div>
        </details>
      ) : (
        <p>
          <span>{label}</span>
          <em>{empty}</em>
        </p>
      )}
    </div>
  );
}

function Pip({
  label,
  state,
  hint,
}: {
  label: string;
  state: "ok" | "off" | "unknown";
  hint: string;
}) {
  const text = state === "ok" ? "ok" : state === "off" ? "não" : "?";
  return (
    <li className="ambiente-pip" data-state={state} title={hint || text}>
      <span aria-hidden />
      <b>{label}</b>
    </li>
  );
}

export function SafeLearningPanel({
  workspaceName,
  workspaceNames,
  onWorkspaceChange,
  workspaceLocked,
  model,
  modelOptions,
  onModelChange,
  muted,
  busy,
  onCommand,
  onInsert,
  onSelectSession,
  commandMenuNonce = 0,
}: {
  workspaceName: string;
  workspaceNames: string[];
  onWorkspaceChange: (name: string) => void;
  workspaceLocked: boolean;
  model: string;
  modelOptions: readonly { id: string; label: string }[];
  onModelChange: (id: string) => void;
  muted: boolean;
  busy: boolean;
  onCommand: (id: string) => void;
  onInsert: (token: string) => void;
  onSelectSession?: (id: string) => void;
  commandMenuNonce?: number;
}) {
  const [memory, setMemory] = useState("");
  const [user, setUser] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionPayload["sessions"]>([]);
  const [knobs, setKnobs] = useState({
    memoryNudgeInterval: 10,
    backgroundReview: true,
  });
  const [computerUse, setComputerUse] = useState<ComputerUsePayload>({});
  const [savingKnobs, setSavingKnobs] = useState(false);
  const [installingCua, setInstallingCua] = useState(false);

  const refresh = useCallback(async () => {
    const [memoryResponse, learningResponse, sessionsResponse, computerResponse] =
      await Promise.all([
        safeCoreFetch("/api/hermes/memory"),
        safeCoreFetch("/api/hermes/learning"),
        safeCoreFetch("/api/hermes/sessions"),
        safeCoreFetch("/api/hermes/computer-use"),
      ]);
    if (memoryResponse.ok) {
      const body = (await memoryResponse.json()) as LearningPayload;
      setMemory(body.memory ?? "");
      setUser(body.user ?? "");
    }
    if (learningResponse.ok) {
      const body = (await learningResponse.json()) as SkillsPayload;
      setSkills((body.skills ?? []).map((skill) => skill.name));
      if (body.knobs) {
        setKnobs({
          memoryNudgeInterval: body.knobs.memoryNudgeInterval ?? 10,
          backgroundReview: body.knobs.backgroundReview ?? true,
        });
      }
    }
    if (sessionsResponse.ok) {
      const body = (await sessionsResponse.json()) as SessionPayload;
      setSessions(body.sessions ?? []);
    }
    if (computerResponse.ok) {
      setComputerUse((await computerResponse.json()) as ComputerUsePayload);
    }
  }, []);

  const saveKnobs = useCallback(async () => {
    setSavingKnobs(true);
    try {
      const response = await safeCoreFetch("/api/hermes/learning", {
        method: "POST",
        body: JSON.stringify({
          memoryNudgeInterval: knobs.memoryNudgeInterval,
          backgroundReview: knobs.backgroundReview,
        }),
      });
      if (response.ok) await refresh();
    } finally {
      setSavingKnobs(false);
    }
  }, [knobs.backgroundReview, knobs.memoryNudgeInterval, refresh]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- remote knobs/memory on mount */
    void refresh();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [refresh]);

  const sessionCount = (sessions ?? []).length;
  const macReady = computerUse.installed === true;

  const commandOptions = useMemo(
    () => [
      { id: "history", label: "Histórico", hint: "⌃H" },
      {
        id: "voice",
        label: muted ? "Voz · mudo" : "Voz · ligada",
        hint: "⌃V",
      },
      { id: "wake", label: "Escuta contínua", hint: "wake" },
      { id: "insert-at", label: "Mencionar modelo", hint: "@" },
      { id: "insert-slash", label: "Invocar skill", hint: "/" },
      { id: "insert-hash", label: "Anexar caminho", hint: "#" },
      { id: "cancel", label: "Cancelar run", hint: "esc", disabled: !busy },
    ],
    [busy, muted],
  );

  return (
    <div className="ambiente" aria-label="Ambiente">
      <header className="ambiente-hero">
        <p className="ambiente-kicker">Ambiente</p>
        <h1 className="ambiente-name">{workspaceName || "—"}</h1>
        <p className="ambiente-meta">
          <span>{String(sessionCount).padStart(2, "0")} sess</span>
          <span>
            {String(skills.length).padStart(2, "0")} skill
            {skills.length === 1 ? "" : "s"}
          </span>
          <span data-ok={macReady ? "true" : "false"}>
            mac {macReady ? "ok" : "—"}
          </span>
        </p>
        <div className="ambiente-menus">
          <HudMenu
            kicker="workspace"
            value={workspaceName}
            options={workspaceNames.map((name) => ({ id: name, label: name }))}
            disabled={workspaceLocked}
            onChange={onWorkspaceChange}
            ariaLabel="Selecionar workspace"
          />
          <HudMenu
            kicker="comando"
            placeholder="atalhos"
            options={commandOptions}
            onChange={onCommand}
            ariaLabel="Comandos"
            openSignal={commandMenuNonce}
          />
          <HudMenu
            kicker="modelo"
            value={model}
            placeholder="escolher"
            options={modelOptions.map((option) => ({
              id: option.id,
              label: option.label,
            }))}
            onChange={onModelChange}
            ariaLabel="Selecionar modelo"
          />
          {skills.length > 0 ? (
            <HudMenu
              kicker="skill"
              placeholder="inserir"
              options={skills.map((name) => ({
                id: name,
                label: name,
                hint: "/",
              }))}
              onChange={(name) => onInsert(`/${name} `)}
              ariaLabel="Inserir skill"
            />
          ) : null}
          {sessionCount > 0 ? (
            <HudMenu
              kicker="sessão"
              placeholder="recentes"
              options={(sessions ?? []).slice(0, 8).map((session) => ({
                id: session.id,
                label: session.title || session.id,
              }))}
              onChange={(id) => {
                if (onSelectSession) onSelectSession(id);
                else onCommand("history");
              }}
              ariaLabel="Sessões recentes"
            />
          ) : null}
        </div>
      </header>

      <div className="ambiente-dossier">
        <SlotNote label="memória" empty="ainda vazia">
          {memory}
        </SlotNote>
        <SlotNote label="você" empty="sem USER.md">
          {user}
        </SlotNote>
        <AmbienteCron />
        <AmbienteChannels />
      </div>

      <footer className="ambiente-deck">
        <div className="ambiente-tempo">
          <label>
            <input
              type="number"
              min={1}
              max={120}
              aria-label="nudge"
              value={knobs.memoryNudgeInterval}
              onChange={(event) =>
                setKnobs((current) => ({
                  ...current,
                  memoryNudgeInterval: Number(event.target.value),
                }))
              }
            />
            <span>min</span>
          </label>
          <label className="ambiente-toggle">
            <input
              type="checkbox"
              checked={knobs.backgroundReview}
              onChange={(event) =>
                setKnobs((current) => ({
                  ...current,
                  backgroundReview: event.target.checked,
                }))
              }
            />
            fundo
          </label>
          <button
            type="button"
            className="btn-press ambiente-commit"
            disabled={savingKnobs}
            onClick={() => void saveKnobs()}
          >
            {savingKnobs ? "…" : "ok"}
          </button>
        </div>
        <ul className="ambiente-pips">
          <li>
            <button
              type="button"
              className="ambiente-pip"
              data-state={computerUse.installed ? "ok" : "off"}
              disabled={installingCua || computerUse.installed === true}
              aria-label="Instalar computer-use"
              title={computerUse.installed ? "ok" : "instalar cua"}
              onClick={() => {
                setInstallingCua(true);
                void safeCoreFetch("/api/hermes/computer-use", { method: "POST" })
                  .then(async (response) => {
                    if (response.ok) {
                      setComputerUse((await response.json()) as ComputerUsePayload);
                    }
                  })
                  .finally(() => setInstallingCua(false));
              }}
            >
              <span aria-hidden />
              <b>{installingCua ? "cua…" : "cua"}</b>
            </button>
          </li>
          <Pip
            label="cap"
            state={computerUse.captureBeforeClick ? "ok" : "unknown"}
            hint={computerUse.captureBeforeClick ? "antes do clique" : "?"}
          />
          <Pip
            label="a11y"
            state={triState(computerUse.tccAccessibility)}
            hint=""
          />
          <Pip
            label="tela"
            state={triState(computerUse.tccScreenRecording)}
            hint=""
          />
        </ul>
        <details className="ambiente-tcc">
          <summary>TCC</summary>
          <p>
            Acessibilidade e Gravação de Tela no python do venv Hermes, não no
            Electron.
          </p>
        </details>
      </footer>
    </div>
  );
}
