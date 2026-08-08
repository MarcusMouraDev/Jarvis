import { executeTool } from "@/tools/executor";
import { getTool } from "@/tools/registry";
import { isSchedulerEnabled } from "@/integrations/flags";
import {
  findJobByIdempotencyKey,
  getJob,
  listJobs,
  upsertJob,
} from "./store";
import type { CreateJobInput, JobExecutionRecord, ScheduledJob } from "./types";

const WRITE_RISKS = new Set(["write", "destructive", "network"]);

export function isSchedulerFeatureEnabled(): boolean {
  return isSchedulerEnabled();
}

export function createJob(input: CreateJobInput): ScheduledJob {
  if (!isSchedulerEnabled()) {
    throw new Error("scheduler_disabled");
  }

  const existing = findJobByIdempotencyKey(input.idempotencyKey);
  if (existing) return existing;

  const now = new Date().toISOString();
  const job: ScheduledJob = {
    id: crypto.randomUUID(),
    idempotencyKey: input.idempotencyKey,
    toolId: input.toolId,
    input: input.input,
    profileId: input.profileId,
    privacyClass: input.privacyClass ?? "internal",
    status: "pending",
    paused: false,
    nextRunAt: input.runAt ?? now,
    maxRetries: input.maxRetries ?? 3,
    retryBackoffMs: input.retryBackoffMs ?? 5_000,
    createdAt: now,
    updatedAt: now,
    history: [],
  };

  return upsertJob(job);
}

export function pauseJob(jobId: string, paused: boolean): ScheduledJob | null {
  const job = getJob(jobId);
  if (!job) return null;
  job.paused = paused;
  job.status = paused ? "paused" : "pending";
  job.updatedAt = new Date().toISOString();
  return upsertJob(job);
}

function computeNextRetry(job: ScheduledJob, attempt: number): string {
  const delay = job.retryBackoffMs * Math.pow(2, attempt - 1);
  return new Date(Date.now() + delay).toISOString();
}

export async function runDueJobs(now = new Date()): Promise<ScheduledJob[]> {
  if (!isSchedulerEnabled()) return [];

  const due = listJobs().filter(
    (j) =>
      !j.paused &&
      j.status !== "completed" &&
      Date.parse(j.nextRunAt) <= now.getTime(),
  );

  const updated: ScheduledJob[] = [];

  for (const job of due) {
    const result = await executeScheduledJob(job.id);
    if (result) updated.push(result);
  }

  return updated;
}

export async function executeScheduledJob(
  jobId: string,
): Promise<ScheduledJob | null> {
  const job = getJob(jobId);
  if (!job || job.paused) return null;

  const tool = getTool(job.toolId);
  if (!tool) {
    job.status = "failed";
    job.updatedAt = new Date().toISOString();
    return upsertJob(job);
  }

  if (WRITE_RISKS.has(tool.risk) && tool.policy.defaultTier === "confirm") {
    job.history.push({
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      status: "skipped",
      summary: "write_tool_requires_approval",
      attempt: job.history.length + 1,
    });
    job.status = "failed";
    job.updatedAt = new Date().toISOString();
    return upsertJob(job);
  }

  const attempt = job.history.filter((h) => h.status !== "skipped").length + 1;
  const record: JobExecutionRecord = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    status: "ok",
    attempt,
  };

  job.status = "running";
  job.updatedAt = new Date().toISOString();
  upsertJob(job);

  const result = await executeTool({
    toolId: job.toolId,
    input: job.input,
    profileId: job.profileId,
    privacyClass: job.privacyClass,
  });

  record.endedAt = new Date().toISOString();

  if (result.status === "ok") {
    record.status = "ok";
    record.summary = "completed";
    job.status = "completed";
    job.nextRunAt = record.endedAt;
  } else if (result.status === "needs_approval") {
    record.status = "skipped";
    record.summary = "needs_approval";
    job.status = "failed";
  } else {
    record.status = "error";
    record.summary = result.reason;
    const failures = job.history.filter((h) => h.status === "error").length + 1;
    if (failures < job.maxRetries) {
      job.status = "pending";
      job.nextRunAt = computeNextRetry(job, failures);
    } else {
      job.status = "failed";
    }
  }

  job.history.push(record);
  job.updatedAt = new Date().toISOString();
  return upsertJob(job);
}
