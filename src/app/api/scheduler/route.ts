import { NextResponse } from "next/server";
import { isSchedulerFeatureEnabled } from "@/scheduler/engine";
import { createJob, pauseJob, runDueJobs } from "@/scheduler/engine";
import { listJobs } from "@/scheduler/store";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";

export const runtime = "nodejs";

export async function GET() {
  if (!isSchedulerFeatureEnabled()) {
    return NextResponse.json({ enabled: false, jobs: [] });
  }
  return NextResponse.json({ enabled: true, jobs: listJobs() });
}

export async function POST(req: Request) {
  if (isSafeAgentCoreEnabled()) {
    return NextResponse.json(
      { error: "legacy_executor_disabled" },
      { status: 410 },
    );
  }

  if (!isSchedulerFeatureEnabled()) {
    return NextResponse.json({ error: "scheduler_disabled" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    action?: "create" | "pause" | "run_due";
    idempotencyKey?: string;
    toolId?: string;
    input?: Record<string, unknown>;
    profileId?: string;
    jobId?: string;
    paused?: boolean;
    runAt?: string;
  } | null;

  if (!body?.action) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  switch (body.action) {
    case "create": {
      if (!body.idempotencyKey || !body.toolId || !body.profileId) {
        return NextResponse.json({ error: "missing_fields" }, { status: 400 });
      }
      const job = createJob({
        idempotencyKey: body.idempotencyKey,
        toolId: body.toolId,
        input: body.input ?? {},
        profileId: body.profileId,
        runAt: body.runAt,
      });
      return NextResponse.json({ job });
    }
    case "pause": {
      if (!body.jobId || body.paused === undefined) {
        return NextResponse.json({ error: "missing_fields" }, { status: 400 });
      }
      const job = pauseJob(body.jobId, body.paused);
      if (!job) {
        return NextResponse.json({ error: "job_not_found" }, { status: 404 });
      }
      return NextResponse.json({ job });
    }
    case "run_due": {
      const jobs = await runDueJobs();
      return NextResponse.json({ jobs });
    }
    default:
      // Runtime JSON can bypass the TypeScript union; keep the public 400 contract.
      const unreachable: never = body.action;
      void unreachable;
      return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }
}
