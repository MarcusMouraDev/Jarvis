import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ScheduledJob } from "./types";

interface SchedulerStore {
  version: number;
  jobs: ScheduledJob[];
}

const STORE_VERSION = 1;

function storePath(): string {
  return path.join(process.cwd(), ".jarvis", "scheduler.json");
}

function emptyStore(): SchedulerStore {
  return { version: STORE_VERSION, jobs: [] };
}

export function loadSchedulerStore(): SchedulerStore {
  try {
    const file = storePath();
    if (!existsSync(file)) return emptyStore();
    const parsed = JSON.parse(readFileSync(file, "utf8")) as SchedulerStore;
    if (!Array.isArray(parsed.jobs)) return emptyStore();
    return parsed;
  } catch {
    return emptyStore();
  }
}

export function saveSchedulerStore(store: SchedulerStore): void {
  try {
    mkdirSync(path.dirname(storePath()), { recursive: true });
    writeFileSync(storePath(), JSON.stringify(store, null, 2), "utf8");
  } catch {
    // Best-effort persistence.
  }
}

export function listJobs(): ScheduledJob[] {
  return loadSchedulerStore().jobs;
}

export function getJob(jobId: string): ScheduledJob | null {
  return listJobs().find((j) => j.id === jobId) ?? null;
}

export function findJobByIdempotencyKey(
  key: string,
): ScheduledJob | null {
  return listJobs().find((j) => j.idempotencyKey === key) ?? null;
}

export function upsertJob(job: ScheduledJob): ScheduledJob {
  const store = loadSchedulerStore();
  const idx = store.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) store.jobs[idx] = job;
  else store.jobs.push(job);
  saveSchedulerStore(store);
  return job;
}

/** Test helper — wipe persisted jobs. */
export function clearSchedulerStore(): void {
  saveSchedulerStore(emptyStore());
}
