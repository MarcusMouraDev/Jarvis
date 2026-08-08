import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { getJarvisDataDir } from "./data-dir";
import { redactSecrets } from "./policy";

export type RunKind =
  | "chat"
  | "shell"
  | "skill"
  | "voice"
  | "memory"
  | "browser"
  | "scheduler"
  | "mcp";
export type RunStatus =
  | "running"
  | "ok"
  | "error"
  | "cancelled"
  | "needs_approval"
  | "denied";

export interface LedgerRun {
  id: string;
  kind: RunKind;
  alias?: string;
  startedAt: string;
  endedAt?: string;
  status: RunStatus;
  costUsd?: number;
  latencyMs?: number;
  summary?: string;
}

export interface LedgerStep {
  runId: string;
  seq: number;
  type: string;
  summary: string;
  at: string;
}

export interface LedgerApproval {
  id: string;
  runId: string;
  action: string;
  scope: string;
  decision: "approved" | "denied" | "pending";
  decidedAt?: string;
  reasons?: string[];
}

export interface ListRunsFilters {
  kind?: RunKind;
  status?: RunStatus;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
}

const runs = new Map<string, LedgerRun>();
const steps = new Map<string, LedgerStep[]>();
const approvals = new Map<string, LedgerApproval>();
const pendingApprovals = new Map<string, LedgerApproval>();

const ROTATE_BYTES = 5 * 1024 * 1024;
let hydrated = false;

function ledgerDir(): string {
  return getJarvisDataDir();
}

function ledgerPath(): string {
  return path.join(ledgerDir(), "runs.jsonl");
}

function maybeRotateLedger() {
  try {
    const filePath = ledgerPath();
    if (existsSync(filePath) && statSync(filePath).size >= ROTATE_BYTES) {
      renameSync(filePath, `${filePath}.1`);
    }
  } catch {
    // Rotation is best-effort.
  }
}

function applyRecord(record: {
  type: string;
  run?: LedgerRun;
  step?: LedgerStep;
  approval?: LedgerApproval;
}) {
  switch (record.type) {
    case "run.start":
      if (record.run) {
        runs.set(record.run.id, record.run);
        if (!steps.has(record.run.id)) steps.set(record.run.id, []);
      }
      break;
    case "run.step":
      if (record.step) {
        const list = steps.get(record.step.runId) ?? [];
        const existing = list.find((s) => s.seq === record.step!.seq);
        if (!existing) list.push(record.step);
        steps.set(record.step.runId, list);
        if (!runs.has(record.step.runId)) {
          runs.set(record.step.runId, {
            id: record.step.runId,
            kind: "chat",
            startedAt: record.step.at,
            status: "running",
          });
        }
      }
      break;
    case "run.finish":
      if (record.run) runs.set(record.run.id, record.run);
      break;
    case "approval.request":
    case "approval.decide":
      if (record.approval) {
        approvals.set(record.approval.id, record.approval);
        if (record.approval.decision === "pending") {
          pendingApprovals.set(record.approval.id, record.approval);
        } else {
          pendingApprovals.delete(record.approval.id);
        }
      }
      break;
    default:
      break;
  }
}

function hydrateFromDisk() {
  if (hydrated) return;
  hydrated = true;
  if (runs.size > 0) return;

  try {
    const filePath = ledgerPath();
    if (!existsSync(filePath)) return;
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        applyRecord(JSON.parse(line) as Parameters<typeof applyRecord>[0]);
      } catch {
        // Skip malformed lines.
      }
    }
  } catch {
    // Disk hydration is best-effort.
  }
}

function persist(record: unknown) {
  try {
    mkdirSync(ledgerDir(), { recursive: true });
    maybeRotateLedger();
    const line = redactSecrets(JSON.stringify(record));
    appendFileSync(ledgerPath(), `${line}\n`, "utf8");
  } catch {
    // Disk persistence is best-effort; in-memory remains source of truth.
  }
}

export function startRun(input: {
  id?: string;
  kind: RunKind;
  alias?: string;
  summary?: string;
}): LedgerRun {
  const run: LedgerRun = {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    alias: input.alias,
    startedAt: new Date().toISOString(),
    status: "running",
    summary: input.summary ? redactSecrets(input.summary) : undefined,
  };
  runs.set(run.id, run);
  steps.set(run.id, []);
  persist({ type: "run.start", run });
  return run;
}

export function addStep(
  runId: string,
  type: string,
  summary: string,
): LedgerStep | null {
  const list = steps.get(runId);
  if (!list) return null;
  const step: LedgerStep = {
    runId,
    seq: list.length + 1,
    type,
    summary: redactSecrets(summary),
    at: new Date().toISOString(),
  };
  list.push(step);
  persist({ type: "run.step", step });
  return step;
}

export function finishRun(
  runId: string,
  status: RunStatus,
  extras?: { costUsd?: number; latencyMs?: number; summary?: string },
): LedgerRun | null {
  const run = runs.get(runId);
  if (!run) return null;
  run.status = status;
  run.endedAt = new Date().toISOString();
  if (extras?.costUsd !== undefined) run.costUsd = extras.costUsd;
  if (extras?.latencyMs !== undefined) run.latencyMs = extras.latencyMs;
  if (extras?.summary) run.summary = redactSecrets(extras.summary);
  persist({ type: "run.finish", run });
  return run;
}

export function requestApproval(input: {
  runId: string;
  action: string;
  scope: string;
  reasons?: string[];
}): LedgerApproval {
  const approval: LedgerApproval = {
    id: crypto.randomUUID(),
    runId: input.runId,
    action: redactSecrets(input.action),
    scope: input.scope,
    decision: "pending",
    reasons: input.reasons,
  };
  approvals.set(approval.id, approval);
  pendingApprovals.set(approval.id, approval);
  persist({ type: "approval.request", approval });
  return approval;
}

export function decideApproval(
  approvalId: string,
  decision: "approved" | "denied",
): LedgerApproval | null {
  const approval = approvals.get(approvalId);
  if (!approval) return null;
  approval.decision = decision;
  approval.decidedAt = new Date().toISOString();
  pendingApprovals.delete(approvalId);
  persist({ type: "approval.decide", approval });
  return approval;
}

export function getApproval(approvalId: string): LedgerApproval | null {
  hydrateFromDisk();
  return approvals.get(approvalId) ?? null;
}

export function listRuns(
  filters: ListRunsFilters | number = {},
): Array<LedgerRun & { stepCount: number }> {
  hydrateFromDisk();

  const opts: ListRunsFilters =
    typeof filters === "number" ? { limit: filters } : filters;
  const limit = opts.limit ?? 50;
  const q = opts.q?.toLowerCase().trim();
  const fromMs = opts.from ? Date.parse(opts.from) : undefined;
  const toMs = opts.to ? Date.parse(opts.to) : undefined;

  let all = [...runs.values()].sort((a, b) =>
    a.startedAt < b.startedAt ? 1 : -1,
  );

  if (opts.kind) all = all.filter((r) => r.kind === opts.kind);
  if (opts.status) all = all.filter((r) => r.status === opts.status);
  if (fromMs !== undefined && !Number.isNaN(fromMs)) {
    all = all.filter((r) => Date.parse(r.startedAt) >= fromMs);
  }
  if (toMs !== undefined && !Number.isNaN(toMs)) {
    all = all.filter((r) => Date.parse(r.startedAt) <= toMs);
  }
  if (q) {
    all = all.filter((r) => {
      const hay = [r.id, r.kind, r.status, r.alias, r.summary]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  return all.slice(0, limit).map((run) => ({
    ...run,
    stepCount: steps.get(run.id)?.length ?? 0,
  }));
}

export function getRun(runId: string): {
  run: LedgerRun;
  steps: LedgerStep[];
  approvals: LedgerApproval[];
} | null {
  hydrateFromDisk();
  const run = runs.get(runId);
  if (!run) return null;
  return {
    run,
    steps: steps.get(runId) ?? [],
    approvals: [...approvals.values()].filter((a) => a.runId === runId),
  };
}

/** Test helper — wipe in-memory state. */
export function clearLedger() {
  runs.clear();
  steps.clear();
  approvals.clear();
  pendingApprovals.clear();
  hydrated = false;
}
