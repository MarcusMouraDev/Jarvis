"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { PRESENCE_BY_STATE } from "@/state/presence-config";
import { useDocumentHidden, useReducedMotion } from "@/hooks/use-reduced-motion";
import { useWebGLAvailable } from "@/hooks/use-webgl";
import { PresenceField } from "@/presence/PresenceField";
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
import { StateLabel } from "./StateLabel";
import type { ChatMessage } from "./HistoryPanel";

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
  const levelRef = useRef(0);
  const [agents, setAgents] = useState<SafeAgentSummary[]>([]);
  const [agentId, setAgentId] = useState<SafeAgentId>("Hermes");
  const [privacyClass] = useState<PrivacyClass>("internal");
  const [input, setInput] = useState("");
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
  const glow =
    ui.presence === "failure"
      ? "#7a8088"
      : PRESENCE_BY_STATE[ui.presence].colorA;

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const applyEvents = useCallback((events: readonly SafeEventEnvelope[]) => {
    setUi(reduceSafeRun(events));
  }, []);

  const connectStream = useCallback(
    async (activeRunId: string, lastEventId: string | null) => {
      stopStream();
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
          setUi((current) => {
            const next = applySafeEvent(current, event);
            local = {
              lastEventId: next.lastEventId,
              lastSeq: next.lastSeq,
              protocolError: next.protocolError,
            };
            if (next.runStatus) setRunStatus(next.runStatus);
            return next;
          });
          if (local.protocolError === "sequence_gap") {
            const snapshotResponse = await safeCoreFetch(
              `/api/runs/${encodeURIComponent(activeRunId)}`,
            );
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
    [applyEvents, stopStream],
  );

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
    const prompt = input.trim();
    if (!prompt || runIsActive) return;
    setError(null);
    setBusy(true);
    setUserPrompt(prompt);
    setInput("");
    setUi(initialSafeRunState());
    try {
      const response = await safeCoreFetch("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          agentId,
          privacyClass,
          workspace: { kind: "none" },
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
    connectStream,
    input,
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
      setRunStatus(snapshot.run.status);
      applyEvents(snapshot.events);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : "cancel_failed",
      );
    } finally {
      setBusy(false);
    }
  }, [applyEvents, runId, stopStream]);

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

  return (
    <div
      className="safe-jarvis-shell relative flex h-dvh flex-col overflow-x-clip"
      style={{ "--state-glow": glow } as React.CSSProperties}
    >
      <div className="shell-vignette" aria-hidden />
      <SafeInstrumentBar
        agentId={agentId}
        privacyClass={privacyClass}
        model={ui.effectiveModel}
        status={runStatus ?? ui.runStatus}
      />
      <main className="relative z-20 flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-2">
          <div className="presence-stage shrink-0">
            <div className="presence-halo" aria-hidden />
            <PresenceField
              state={ui.presence}
              levelRef={levelRef}
              reducedMotion={reducedMotion}
              paused={documentHidden}
              webglAvailable={webglAvailable}
            />
          </div>
          <div className="mt-3 flex w-full flex-col items-center gap-2 sm:mt-4">
            <StateLabel state={ui.presence} />
            <FallbackStrip
              visible={Boolean(ui.fallback)}
              requestedAlias={ui.fallback?.from ?? ""}
              effectiveAlias={ui.fallback?.to ?? ""}
              reason={ui.fallback?.reason}
            />
            {error || ui.protocolError ? (
              <p className="text-center text-xs text-ink-1" role="alert">
                {error ?? ui.protocolError}
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
                onChange={setInput}
                onSubmit={() => void onSubmit()}
              />
            </div>
            {runIsActive ? (
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
