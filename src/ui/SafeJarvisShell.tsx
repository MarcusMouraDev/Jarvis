"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SafeAgentId,
  SafeAgentSummary,
  SafeEventEnvelope,
  SafeRunSnapshot,
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
import { LastExchange } from "./LastExchange";
import { SafeAgentSelector } from "./SafeAgentSelector";
import { SafeApprovalCard } from "./SafeApprovalCard";
import { SafeInstrumentBar } from "./SafeInstrumentBar";
import { PresenceStage } from "./PresenceStage";
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
import { serializeUserPrompt } from "@/composer/serialize-payload";
import {
  extractLeadingModelMention,
  isPaidSafeModel,
  resolveSafeModelAlias,
  SAFE_MODEL_ALIASES,
  SAFE_MODEL_PICKER_ALIASES,
  displayNameForSafeModel,
} from "@/composer/safe-model-alias";
import type { ChatMessage } from "./HistoryPanel";

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
  const [agents, setAgents] = useState<SafeAgentSummary[]>([]);
  const [agentId, setAgentId] = useState<SafeAgentId>("Hermes");
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
  const [instrumentHeight, setInstrumentHeight] = useState(56);
  const [usageOpen, setUsageOpen] = useState(false);
  const usage = useOmnirouteUsage({ open: usageOpen });
  const onInstrumentHeight = useCallback((h: number) => {
    setInstrumentHeight(Math.max(40, Math.round(h)));
  }, []);

  const [glow, setGlow] = useState(IDLE_PRESENCE_VISUAL.colorA);

  const commitUi = useCallback((next: SafeRunUiState) => {
    setUi(next);
    setGlow((prev) =>
      next.presence === "failure"
        ? prev
        : PRESENCE_BY_STATE[next.presence].colorA,
    );
  }, []);

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

        const agentsResponse = await safeCoreFetch("/api/agents");
        if (agentsResponse.ok) {
          const body = (await agentsResponse.json()) as {
            agents?: SafeAgentSummary[];
          };
          if (!cancelled && body.agents) setAgents(body.agents);
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

  const updateAgent = useCallback(
    async (nextAgentId: SafeAgentId) => {
      if (runIsActive) return;
      setAgentId(nextAgentId);
      try {
        await safeCoreFetch("/api/session/bootstrap", {
          method: "PATCH",
          body: JSON.stringify({ defaultAgentId: nextAgentId }),
        });
      } catch {
        setError("agent_update_failed");
      }
    },
    [runIsActive],
  );

  const onSubmit = useCallback(async () => {
    const raw = input.trim();
    if (!raw || runIsActive) return;

    const payload = serializeUserPrompt(
      { text: raw, chips: composerChips, cursor: raw.length },
      preferredModel ?? "local",
    );
    const leading = extractLeadingModelMention(payload.userText);
    const aliasCandidate = leading?.alias ?? payload.alias;
    const modelAlias = resolveSafeModelAlias(aliasCandidate, SAFE_MODEL_ALIASES);
    const prompt = (leading?.rest ?? payload.userText).trim();
    if (!prompt) return;

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
          workspace: { kind: "none" },
          ...(modelAlias
            ? {
                modelAlias,
                allowPaidProvider: isPaidSafeModel(modelAlias),
              }
            : {}),
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

  const decideApproval = useCallback(
    async (decision: "approved" | "denied") => {
      const approval = ui.pendingApproval;
      if (!approval || !runId) return;
      setDecisionBusy(true);
      try {
        const response = await safeCoreFetch(
          `/api/approvals/${encodeURIComponent(approval.approvalId)}`,
          {
            method: "POST",
            body: JSON.stringify({ decision }),
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
      className="safe-jarvis-shell relative flex min-h-dvh flex-col overflow-x-clip"
      style={
        {
          "--state-glow": glow,
          "--instrument-height": `${instrumentHeight}px`,
        } as React.CSSProperties
      }
    >
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
          <OmnirouteStatusChip
            report={usage.report}
            onOpen={() => setUsageOpen(true)}
          />
        }
        onHeightChange={onInstrumentHeight}
      />
      <main className="relative z-20 flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-3 pt-3 sm:px-4 sm:pt-4">
        <HudFrame snapshot={telemetry} />
        <OmnirouteUsagePanel
          open={usageOpen}
          report={usage.report}
          loading={usage.loading}
          onClose={() => setUsageOpen(false)}
          onRefresh={() => void usage.refresh()}
        />
        <div className="presence-arena flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-4 sm:py-6">
          <PresenceStage state={ui.presence} telemetry={telemetry}>
            <PresenceField
              state={ui.presence}
              levelRef={levelRef}
              reducedMotion={reducedMotion}
              paused={documentHidden}
              webglAvailable={webglAvailable}
            />
          </PresenceStage>
          <div className="presence-caption mt-3 flex w-full flex-col items-center gap-2 sm:mt-4">
            <StateLabel state={ui.presence} />
            <FallbackStrip
              visible={Boolean(ui.fallback)}
              requestedAlias={ui.fallback?.from ?? ""}
              effectiveAlias={ui.fallback?.to ?? ""}
              reason={ui.fallback?.reason}
            />
            {error || ui.protocolError || ui.failureReason ? (
              <p className="max-w-md text-center text-xs text-ink-1" role="alert">
                {error ??
                  explainSafeFailure(ui.protocolError) ??
                  explainSafeFailure(ui.failureReason)}
              </p>
            ) : null}
          </div>
          <LastExchange messages={messages} />
          {ui.pendingApproval ? (
            <SafeApprovalCard
              approval={ui.pendingApproval}
              busy={decisionBusy}
              onDecision={decideApproval}
            />
          ) : null}
        </div>
      </main>
      <footer className="chrome-z shrink-0 border-t border-surface-2/80 bg-surface-0/95 px-3 py-3 backdrop-blur-sm sm:px-4">
        <div className="mx-auto flex w-full max-w-[65ch] flex-col gap-2">
          <SafeAgentSelector
            agents={agents}
            value={agentId}
            runIsActive={runIsActive}
            onChange={updateAgent}
          />
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Composer
                value={input}
                disabled={runIsActive}
                chips={composerChips}
                onChange={setInput}
                onChipsChange={setComposerChips}
                modelAliases={[...SAFE_MODEL_PICKER_ALIASES]}
                onSubmit={() => void onSubmit()}
              />
            </div>
            {runIsActive && runId ? (
              <button
                type="button"
                className="btn-press mb-1 rounded-md px-3 py-2 text-xs text-ink-1 hover:text-ink-0"
                onClick={() => void cancel()}
              >
                cancel
              </button>
            ) : null}
          </div>
        </div>
      </footer>
    </div>
  );
}
