"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SafeAgentId,
  SafeEventEnvelope,
  SafeRunSnapshot,
  SafeRunSummary,
} from "@/core/safe-api-contract";
import type { PrivacyClass } from "@/core/types";
import {
  ensureSafeSession,
  safeCoreFetch,
  streamRunEvents,
} from "@/lib/safe-core-client";
import {
  IDLE_PRESENCE_VISUAL,
  PRESENCE_BY_STATE,
} from "@/state/presence-config";
import { useDocumentHidden, useReducedMotion } from "@/hooks/use-reduced-motion";
import { useWebGLAvailable } from "@/hooks/use-webgl";
import { PresenceField } from "@/presence/PresenceField";
import { useStreamLevel } from "@/presence/use-stream-level";
import {
  applySafeEvent,
  initialSafeRunState,
  reduceSafeRun,
  type SafeRunUiState,
} from "./safe-run-reducer";
import { Composer } from "./Composer";
import { FallbackStrip } from "./FallbackStrip";
import { Transcript } from "./Transcript";
import { SafeApprovalCard } from "./SafeApprovalCard";
import { SafeInstrumentBar } from "./SafeInstrumentBar";
import { PresenceStage } from "./PresenceStage";
import { ViewportAtmosphere } from "./ViewportAtmosphere";
import { SafeLearningPanel } from "./SafeLearningPanel";
import { SubagentRail } from "./SubagentRail";
import { TaskGraphPanel } from "./TaskGraphPanel";
import { SafeClarifyCard } from "./SafeClarifyCard";
import { HudFrame } from "./hud/HudFrame";
import { buildTelemetry } from "./hud/telemetry-data";
import { StateLabel } from "./StateLabel";
import {
  OmnirouteStatusChip,
  OmnirouteUsagePanel,
  useOmnirouteUsage,
} from "./OmnirouteUsagePanel";
import { explainSafeFailure } from "./safe-failure-message";
import type { ComposerChip } from "@/composer/mention-types";
import { attachmentsFromChips } from "@/composer/attachments";
import { serializeUserPrompt } from "@/composer/serialize-payload";
import {
  extractLeadingModelMention,
  isPaidSafeModel,
  resolveSafeModelAlias,
  SAFE_MODEL_ALIASES,
  SAFE_MODEL_PICKER_ALIASES,
  displayNameForSafeModel,
} from "@/composer/safe-model-alias";
import { usePushToTalk } from "@/audio/use-push-to-talk";
import { speakWithBrowser } from "@/audio/speech-synthesis";
import type { HermesApprovalChoice } from "@/integrations/hermes/approval-map";
import {
  HistoryPanel,
  type ChatMessage,
  type RunSummary,
} from "./HistoryPanel";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel";
import { DevicesPanel } from "./DevicesPanel";
import { JarvisPrimaryNav, type JarvisSurface } from "./JarvisPrimaryNav";

const EMPTY_CHIPS: ComposerChip[] = [];

const ACTIVE_STATUSES = new Set([
  "pending",
  "running",
  "waiting_approval",
]);

function isActiveRun(status: string | null | undefined): boolean {
  return Boolean(status && ACTIVE_STATUSES.has(status));
}

export function SafeJarvisShell() {
  const abortRef = useRef<AbortController | null>(null);
  const streamGenRef = useRef(1);
  const { levelRef, noteDelta } = useStreamLevel();
  const [agentId, setAgentId] = useState<SafeAgentId>("Hermes");
  const [workspaceName, setWorkspaceName] = useState("jarvis");
  const [workspaceNames, setWorkspaceNames] = useState<string[]>(["jarvis"]);
  const [privacyClass] = useState<PrivacyClass>("internal");
  const [input, setInput] = useState("");
  const [composerChips, setComposerChips] = useState<ComposerChip[]>(EMPTY_CHIPS);
  const [preferredModel, setPreferredModel] = useState<string | null>("local");
  const [busy, setBusy] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [ui, setUi] = useState<SafeRunUiState>(() => initialSafeRunState());
  const [userPrompt, setUserPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reducedMotion = useReducedMotion();
  const documentHidden = useDocumentHidden();
  const webglAvailable = useWebGLAvailable();

  const runIsActive = busy || isActiveRun(runStatus) || isActiveRun(ui.runStatus);
  const ptt = usePushToTalk({
    onTranscript: (text) =>
      setInput((current) => (current ? `${current} ${text}` : text)),
    disabled: runIsActive,
  });
  const [instrumentHeight, setInstrumentHeight] = useState(56);
  const [usageOpen, setUsageOpen] = useState(false);
  const usage = useOmnirouteUsage({ open: usageOpen });
  const onInstrumentHeight = useCallback((h: number) => {
    setInstrumentHeight(Math.max(40, Math.round(h)));
  }, []);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const [orbCollapsed, setOrbCollapsed] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<"messages" | "runs">("messages");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [commandMenuNonce, setCommandMenuNonce] = useState(0);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [wakeOwned, setWakeOwned] = useState(false);
  const [hermesUp, setHermesUp] = useState<boolean | null>(null);
  const [activeSurface, setActiveSurface] = useState<JarvisSurface>("conversation");

  const [glow, setGlow] = useState(IDLE_PRESENCE_VISUAL.colorA);

  const commitUi = useCallback((next: SafeRunUiState) => {
    setUi(next);
    setGlow((prev) =>
      next.presence === "failure"
        ? prev
        : PRESENCE_BY_STATE[next.presence].colorA,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const response = await safeCoreFetch("/api/hermes/health");
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { gateway?: string };
        if (!cancelled) setHermesUp(body.gateway === "up");
      } catch {
        if (!cancelled) setHermesUp(false);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("jarvis.hermes.mute") === "1";
    mutedRef.current = stored;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate persisted preference.
    setMuted(stored);
  }, []);

  const spokenRef = useRef("");
  useEffect(() => {
    if (muted || ui.runStatus !== "completed" || !ui.assistantText) return;
    if (spokenRef.current === ui.assistantText) return;
    spokenRef.current = ui.assistantText;
    void speakWithBrowser(ui.assistantText).catch(() => undefined);
  }, [muted, ui.assistantText, ui.runStatus]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    window.localStorage.setItem("jarvis.hermes.mute", next ? "1" : "0");
    setMuted(next);
  }, []);

  const startWake = useCallback(async () => {
    if (ptt.listening) return;
    const response = await safeCoreFetch("/api/hermes/wake", { method: "POST" });
    if (response.status === 409) {
      setWakeOwned(true);
      return;
    }
    setWakeOwned(false);
  }, [ptt.listening]);

  const stopStream = useCallback(() => {
    streamGenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const applyEvents = useCallback(
    (events: readonly SafeEventEnvelope[]) => {
      commitUi(reduceSafeRun(events));
    },
    [commitUi],
  );

  const connectStream = useCallback(
    async (activeRunId: string, lastEventId: string | null) => {
      stopStream();
      const gen = streamGenRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      let local = lastEventId
        ? { lastEventId, lastSeq: 0, protocolError: null as string | null }
        : { lastEventId: null as string | null, lastSeq: 0, protocolError: null as string | null };

      try {
        for await (const event of streamRunEvents(
          activeRunId,
          lastEventId,
          controller.signal,
        )) {
          if (controller.signal.aborted) break;
          if (event.type === "text.delta") {
            const payload = event.payload as { text?: unknown } | null;
            if (payload && typeof payload.text === "string") {
              noteDelta(payload.text.length);
            }
          }
          setUi((current) => {
            if (streamGenRef.current !== gen) return current;
            const next = applySafeEvent(current, event);
            local = {
              lastEventId: next.lastEventId,
              lastSeq: next.lastSeq,
              protocolError: next.protocolError,
            };
            if (next.runStatus) setRunStatus(next.runStatus);
            setGlow((prev) =>
              next.presence === "failure"
                ? prev
                : PRESENCE_BY_STATE[next.presence].colorA,
            );
            return next;
          });
          if (local.protocolError === "sequence_gap") {
            if (controller.signal.aborted) break;
            const snapshotResponse = await safeCoreFetch(
              `/api/runs/${encodeURIComponent(activeRunId)}`,
            );
            if (controller.signal.aborted) return;
            if (!snapshotResponse.ok) throw new Error("snapshot_refetch_failed");
            const snapshot = (await snapshotResponse.json()) as SafeRunSnapshot;
            applyEvents(snapshot.events);
            setRunStatus(snapshot.run.status);
            await connectStream(
              activeRunId,
              snapshot.events.at(-1)?.eventId ?? null,
            );
            return;
          }
        }
      } catch (streamError) {
        if (controller.signal.aborted) return;
        setError(
          streamError instanceof Error ? streamError.message : "stream_failed",
        );
        setUi((current) => ({
          ...current,
          presence: "failure",
          protocolError: current.protocolError ?? "stream_failed",
        }));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
      }
    },
    [applyEvents, noteDelta, stopStream],
  );

  useEffect(() => {
    const desktop = window.jarvisDesktop;
    if (!desktop) return;
    return desktop.onOpenUsagePanel(() => setUsageOpen(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await ensureSafeSession();
        if (cancelled) return;
        setAgentId(session.defaultAgentId);

        const workspacesResponse = await safeCoreFetch("/api/workspaces");
        if (workspacesResponse.ok) {
          const body = (await workspacesResponse.json()) as {
            workspaces?: Array<{ kind: string; name?: string }>;
          };
          const names = (body.workspaces ?? [])
            .map((workspace) => workspace.name)
            .filter((name): name is string => Boolean(name));
          if (!cancelled && names.length > 0) {
            setWorkspaceNames(names);
            setWorkspaceName((current) =>
              names.includes(current) ? current : names[0]!,
            );
          }
        }

        const runsResponse = await safeCoreFetch("/api/runs?limit=1");
        if (!runsResponse.ok) return;
        const runsBody = (await runsResponse.json()) as {
          runs?: Array<{ runId: string; status: string; agentId?: string }>;
        };
        const latest = runsBody.runs?.[0];
        if (!latest || cancelled) return;

        const snapshotResponse = await safeCoreFetch(
          `/api/runs/${encodeURIComponent(latest.runId)}`,
        );
        if (!snapshotResponse.ok || cancelled) return;
        const snapshot = (await snapshotResponse.json()) as SafeRunSnapshot;
        setRunId(snapshot.run.runId);
        setRunStatus(snapshot.run.status);
        if (snapshot.run.agentId) {
          setAgentId(snapshot.run.agentId as SafeAgentId);
        }
        applyEvents(snapshot.events);
        const pending = snapshot.approvals.find(
          (approval) => approval.status === "pending",
        );
        if (pending) {
          setUi((current) => ({
            ...current,
            pendingApproval: pending,
            presence: current.presence === "idle" ? "asking" : current.presence,
          }));
        }
        if (isActiveRun(snapshot.run.status)) {
          setBusy(true);
          await connectStream(
            snapshot.run.runId,
            snapshot.events.at(-1)?.eventId ?? null,
          );
        }
      } catch (bootError) {
        if (!cancelled) {
          setError(
            bootError instanceof Error ? bootError.message : "bootstrap_failed",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [applyEvents, connectStream, stopStream]);

  const onSubmit = useCallback(async () => {
    const raw = input.trim();
    const attachments = attachmentsFromChips(composerChips);
    if ((!raw && attachments.length === 0) || runIsActive) return;

    const payload = serializeUserPrompt(
      { text: raw, chips: composerChips, cursor: raw.length },
      preferredModel ?? "local",
    );
    const leading = extractLeadingModelMention(payload.userText);
    const aliasCandidate = leading?.alias ?? payload.alias;
    const modelAlias = resolveSafeModelAlias(aliasCandidate, SAFE_MODEL_ALIASES);
    const prompt = (leading?.rest ?? payload.userText).trim() || "veja o anexo";

    if (modelAlias) setPreferredModel(modelAlias);

    setError(null);
    setBusy(true);
    setUserPrompt(
      modelAlias
        ? `@${displayNameForSafeModel(modelAlias)} ${prompt}`
        : prompt,
    );
    setInput("");
    setComposerChips(EMPTY_CHIPS);
    setUi(initialSafeRunState());
    setGlow(IDLE_PRESENCE_VISUAL.colorA);
    try {
      const response = await safeCoreFetch("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          agentId,
          privacyClass,
          workspace:
            workspaceName.length > 0
              ? { kind: "existing", name: workspaceName }
              : { kind: "none" },
          ...(modelAlias
            ? {
                modelAlias,
                allowPaidProvider: isPaidSafeModel(modelAlias),
              }
            : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
      });
      if (!response.ok) {
        throw new Error(`create_run_${response.status}`);
      }
      const snapshot = (await response.json()) as SafeRunSnapshot;
      setRunId(snapshot.run.runId);
      setRunStatus(snapshot.run.status);
      applyEvents(snapshot.events);
      await connectStream(
        snapshot.run.runId,
        snapshot.events.at(-1)?.eventId ?? null,
      );
    } catch (submitError) {
      setBusy(false);
      setError(
        submitError instanceof Error ? submitError.message : "create_run_failed",
      );
      setUi((current) => ({ ...current, presence: "failure" }));
    }
  }, [
    agentId,
    applyEvents,
    composerChips,
    connectStream,
    input,
    preferredModel,
    privacyClass,
    runIsActive,
    workspaceName,
  ]);

  const cancel = useCallback(async () => {
    if (!runId) return;
    stopStream();
    setBusy(true);
    try {
      const response = await safeCoreFetch(
        `/api/runs/${encodeURIComponent(runId)}/cancel`,
        { method: "POST", body: "{}" },
      );
      if (!response.ok) throw new Error(`cancel_${response.status}`);
      const snapshot = (await response.json()) as SafeRunSnapshot;
      const reduced = reduceSafeRun(snapshot.events);
      const next =
        isActiveRun(snapshot.run.status) || isActiveRun(reduced.runStatus)
          ? {
              ...reduced,
              runStatus: "cancelled",
              presence: "idle" as const,
              pendingApproval: null,
            }
          : reduced;
      commitUi(next);
      setRunStatus(next.runStatus);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : "cancel_failed",
      );
    } finally {
      setBusy(false);
    }
  }, [commitUi, runId, stopStream]);

  const resumeSession = useCallback(
    async (hermesSessionId: string) => {
      if (runIsActive) return;
      setBusy(true);
      setError(null);
      setUi(initialSafeRunState());
      try {
        const response = await safeCoreFetch("/api/hermes/sessions", {
          method: "POST",
          body: JSON.stringify({ sessionId: hermesSessionId }),
        });
        if (!response.ok) throw new Error(`resume_${response.status}`);
        const snapshot = (await response.json()) as SafeRunSnapshot;
        setRunId(snapshot.run.runId);
        setRunStatus(snapshot.run.status);
        applyEvents(snapshot.events);
        await connectStream(
          snapshot.run.runId,
          snapshot.events.at(-1)?.eventId ?? null,
        );
      } catch (resumeError) {
        setBusy(false);
        setError(
          resumeError instanceof Error ? resumeError.message : "resume_failed",
        );
      }
    },
    [applyEvents, connectStream, runIsActive],
  );

  const insertToken = useCallback((token: string) => {
    setInput((current) => {
      if (!current) return token;
      return /[\s]$/.test(current) ? `${current}${token}` : `${current} ${token}`;
    });
    queueMicrotask(() => {
      document.getElementById("jarvis-composer")?.focus();
    });
  }, []);

  const onAmbienteCommand = useCallback(
    (id: string) => {
      switch (id) {
        case "history":
          setHistoryOpen(true);
          setHistoryTab("messages");
          return;
        case "voice":
          toggleMute();
          return;
        case "wake":
          void startWake();
          return;
        case "insert-at":
          insertToken("@");
          return;
        case "insert-slash":
          insertToken("/");
          return;
        case "insert-hash":
          insertToken("#");
          return;
        case "cancel":
          void cancel();
          return;
        default:
          return;
      }
    },
    [cancel, insertToken, startWake, toggleMute],
  );

  const modelOptions = useMemo(
    () =>
      SAFE_MODEL_PICKER_ALIASES.map((id) => ({
        id,
        label: displayNameForSafeModel(id),
      })),
    [],
  );

  useEffect(() => {
    if (!historyOpen) return;
    let cancelled = false;
    void (async () => {
      const response = await safeCoreFetch("/api/runs?limit=20");
      if (!response.ok || cancelled) return;
      const body = (await response.json()) as { runs?: SafeRunSummary[] };
      if (cancelled) return;
      setRuns(
        (body.runs ?? []).map((run) => ({
          id: run.runId,
          kind: run.agentId,
          status: run.status,
          summary: run.requestedModel,
          startedAt: run.createdAt,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [historyOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        Boolean(target?.isContentEditable);
      if (event.key === "Escape") {
        if (historyOpen) {
          event.preventDefault();
          setHistoryOpen(false);
          return;
        }
        if (runIsActive) {
          event.preventDefault();
          void cancel();
        }
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setLeftOpen(true);
        setCommandMenuNonce((nonce) => nonce + 1);
        return;
      }
      if (key === "h") {
        event.preventDefault();
        setHistoryOpen((open) => !open);
        return;
      }
      if (key === "v") {
        if (typing) return;
        event.preventDefault();
        toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, historyOpen, runIsActive, toggleMute]);

  const decideApproval = useCallback(
    async (decision: "approved" | "denied", choice?: HermesApprovalChoice) => {
      const approval = ui.pendingApproval;
      if (!approval || !runId) return;
      setDecisionBusy(true);
      try {
        const response = await safeCoreFetch(
          `/api/approvals/${encodeURIComponent(approval.approvalId)}`,
          {
            method: "POST",
            body: JSON.stringify({
              decision,
              ...(choice ? { choice } : {}),
            }),
          },
        );
        if (!response.ok) throw new Error(`approval_${response.status}`);
        const snapshot = (await response.json()) as SafeRunSnapshot;
        setRunStatus(snapshot.run.status);
        applyEvents(snapshot.events);
        if (isActiveRun(snapshot.run.status)) {
          setBusy(true);
          await connectStream(
            snapshot.run.runId,
            snapshot.events.at(-1)?.eventId ?? null,
          );
        }
      } catch (decisionError) {
        setError(
          decisionError instanceof Error
            ? decisionError.message
            : "approval_failed",
        );
      } finally {
        setDecisionBusy(false);
      }
    },
    [applyEvents, connectStream, runId, ui.pendingApproval],
  );

  const messages: ChatMessage[] = [];
  if (userPrompt) {
    messages.push({
      id: "user-latest",
      role: "user",
      text: userPrompt,
    });
  }
  if (ui.assistantText) {
    messages.push({
      id: "assistant-latest",
      role: "assistant",
      text: ui.assistantText,
      meta: ui.effectiveModel
        ? `${ui.effectiveModel.provider}/${ui.effectiveModel.model}`
        : undefined,
    });
  }

  const telemetry = useMemo(
    () =>
      buildTelemetry({
        report: usage.report,
        runStatus: runStatus ?? ui.runStatus,
        presence: ui.presence,
        model: ui.effectiveModel,
        assistantChars: ui.assistantText.length,
      }),
    [
      usage.report,
      runStatus,
      ui.runStatus,
      ui.presence,
      ui.effectiveModel,
      ui.assistantText.length,
    ],
  );

  return (
    <div
      className="safe-jarvis-shell workbench-shell relative min-h-dvh overflow-x-clip"
      style={
        {
          "--state-glow": glow,
          "--instrument-height": `${instrumentHeight}px`,
        } as React.CSSProperties
      }
    >
      <ViewportAtmosphere />
      <div className="shell-vignette" aria-hidden />
      <SafeInstrumentBar
        agentId={agentId}
        privacyClass={privacyClass}
        model={
          ui.effectiveModel ??
          (preferredModel
            ? {
                provider: displayNameForSafeModel(preferredModel),
                model: displayNameForSafeModel(preferredModel),
              }
            : null)
        }
        status={runStatus ?? ui.runStatus}
        extra={
          <span className="inline-flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                usage.report?.omniUp ? "bg-emerald-400" : "bg-rose-400"
              }`}
              title="OmniRoute"
              aria-label={usage.report?.omniUp ? "OmniRoute up" : "OmniRoute down"}
            />
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                hermesUp ? "bg-emerald-400" : "bg-rose-400"
              }`}
              title="Hermes"
              aria-label={hermesUp ? "Hermes up" : "Hermes down"}
            />
            <OmnirouteStatusChip
              report={usage.report}
              onOpen={() => setUsageOpen(true)}
            />
            <button
              type="button"
              className="xl:hidden"
              onClick={() => setLeftOpen((open) => !open)}
            >
              ambiente
            </button>
          </span>
        }
        onHeightChange={onInstrumentHeight}
      />
      <aside
        className={`workbench-rail workbench-rail--left z-20 flex-col overflow-y-auto p-0 ${
          leftOpen ? "is-open flex" : "hidden xl:flex"
        }`}
      >
        <SafeLearningPanel
          workspaceName={workspaceName}
          workspaceNames={workspaceNames}
          workspaceLocked={runIsActive}
          onWorkspaceChange={setWorkspaceName}
          model={preferredModel ?? ""}
          modelOptions={modelOptions}
          onModelChange={setPreferredModel}
          muted={muted}
          busy={runIsActive}
          onCommand={onAmbienteCommand}
          onSelectSession={(id) => void resumeSession(id)}
          onInsert={insertToken}
          commandMenuNonce={commandMenuNonce}
        />
      </aside>
      <section
        ref={transcriptRef}
        className="workbench-center relative z-20 flex min-h-0 flex-col overflow-y-auto px-3 pt-3 sm:px-4 sm:pt-4"
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          setOrbCollapsed(top > 48);
        }}
      >
        <OmnirouteUsagePanel
          open={usageOpen}
          report={usage.report}
          loading={usage.loading}
          onClose={() => setUsageOpen(false)}
          onRefresh={() => void usage.refresh()}
        />
        <div
          className={`presence-arena orb-stage z-20 flex w-full flex-col items-center justify-center py-4 sm:py-6 ${
            orbCollapsed ? "is-collapsed" : ""
          }`}
        >
          <HudFrame snapshot={telemetry}>
            <PresenceStage
              state={ptt.listening || wakeOwned ? "listening" : ui.presence}
              compact={orbCollapsed}
              telemetry={telemetry}
            >
              <PresenceField
                state={ptt.listening || wakeOwned ? "listening" : ui.presence}
                levelRef={levelRef}
                reducedMotion={reducedMotion}
                paused={documentHidden}
                webglAvailable={webglAvailable}
              />
            </PresenceStage>
          </HudFrame>
          <div className="presence-caption mt-2 flex w-full flex-col items-center gap-2 sm:mt-3">
            <StateLabel
              state={ptt.listening || wakeOwned ? "listening" : ui.presence}
            />
            <FallbackStrip
              visible={Boolean(ui.fallback)}
              requestedAlias={ui.fallback?.from ?? ""}
              effectiveAlias={ui.fallback?.to ?? ""}
              reason={ui.fallback?.reason}
            />
            {error || ui.protocolError || ui.failureReason ? (
              <p className="max-w-[76ch] text-left text-xs text-ink-1" role="alert">
                {error ??
                  explainSafeFailure(ui.protocolError) ??
                  explainSafeFailure(ui.failureReason)}
              </p>
            ) : null}
          </div>
        </div>
        <Transcript messages={messages} />
        <TaskGraphPanel assistantText={ui.assistantText} tools={ui.tools} />
        <SubagentRail runId={runId} subagents={ui.subagents} />
        {ui.pendingClarify && runId ? (
          <SafeClarifyCard
            runId={runId}
            requestId={ui.pendingClarify.requestId}
            prompt={ui.pendingClarify.prompt}
            busy={runIsActive}
          />
        ) : null}
        <div className="composer-bay mx-auto mt-auto w-full max-w-[76ch] py-3">
          <Composer
            value={input}
            disabled={runIsActive}
            busy={runIsActive}
            chips={composerChips}
            onChange={setInput}
            onChipsChange={setComposerChips}
            modelAliases={[...SAFE_MODEL_PICKER_ALIASES]}
            onSubmit={() => void onSubmit()}
            onCancel={() => void cancel()}
          />
          <div className="voice-cluster" role="group" aria-label="Voz">
            <button
              type="button"
              className="voice-key"
              data-on={wakeOwned ? "true" : "false"}
              aria-label="Escuta contínua"
              disabled={ptt.listening}
              onClick={() => void startWake()}
            >
              {wakeOwned ? "ocupado" : "wake"}
            </button>
            <button
              type="button"
              className="voice-key"
              data-on={ptt.listening ? "true" : "false"}
              aria-label="Microfone"
              aria-pressed={ptt.listening}
              disabled={runIsActive}
              onMouseDown={() => void ptt.start()}
              onMouseUp={ptt.stop}
              onTouchStart={() => void ptt.start()}
              onTouchEnd={ptt.stop}
            >
              {ptt.listening ? "ouvindo" : "mic"}
            </button>
            <button
              type="button"
              className="voice-key"
              data-on={muted ? "false" : "true"}
              aria-pressed={muted}
              aria-label="Mudo"
              onClick={toggleMute}
            >
              {muted ? "mudo" : "voz"}
            </button>
            {runIsActive && runId ? (
              <button
                type="button"
                className="voice-key"
                aria-label="cancel"
                onClick={() => void cancel()}
              >
                cancel
              </button>
            ) : null}
          </div>
        </div>
      </section>
      {activeSurface !== "conversation" ? (
        <main className="fixed inset-x-0 bottom-12 z-30 overflow-y-auto bg-surface-0/98 pt-[var(--instrument-height)] backdrop-blur xl:left-[min(21rem,25vw)]">
          {activeSurface === "files" ? (
            <WorkspaceFilesPanel workspaceId={workspaceName} />
          ) : (
            <DevicesPanel />
          )}
        </main>
      ) : null}
      {ui.pendingApproval ? (
        <SafeApprovalCard
          approval={ui.pendingApproval}
          busy={decisionBusy}
          onDecision={decideApproval}
        />
      ) : null}
      <HistoryPanel
        open={historyOpen}
        messages={messages}
        runs={runs}
        tab={historyTab}
        onTabChange={setHistoryTab}
        onClose={() => setHistoryOpen(false)}
      />
      <JarvisPrimaryNav
        active={activeSurface}
        onChange={setActiveSurface}
        onActivity={() => {
          setHistoryTab("runs");
          setHistoryOpen(true);
        }}
      />
    </div>
  );
}
