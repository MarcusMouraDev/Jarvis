import type { PrivacyClass } from "@/core/types";

export type JobStatus = "pending" | "running" | "paused" | "completed" | "failed";

export interface JobExecutionRecord {
  id: string;
  startedAt: string;
  endedAt?: string;
  status: "ok" | "error" | "skipped";
  summary?: string;
  attempt: number;
}

export interface ScheduledJob {
  id: string;
  idempotencyKey: string;
  toolId: string;
  input: Record<string, unknown>;
  profileId: string;
  privacyClass: PrivacyClass;
  status: JobStatus;
  paused: boolean;
  nextRunAt: string;
  maxRetries: number;
  retryBackoffMs: number;
  createdAt: string;
  updatedAt: string;
  history: JobExecutionRecord[];
}

export interface CreateJobInput {
  idempotencyKey: string;
  toolId: string;
  input: Record<string, unknown>;
  profileId: string;
  privacyClass?: PrivacyClass;
  runAt?: string;
  maxRetries?: number;
  retryBackoffMs?: number;
}
