import { HermesGatewayClient } from "./gateway-client";

export interface CronJobView {
  id?: string;
  name?: string;
  schedule?: string;
  prompt?: string;
  paused?: boolean;
  enabled?: boolean;
  next_run_at?: string;
  [key: string]: unknown;
}

export async function manageCron(
  params: Record<string, unknown>,
  client: Pick<HermesGatewayClient, "connect" | "request" | "close"> = new HermesGatewayClient(),
): Promise<unknown> {
  await client.connect(8_000);
  try {
    return await client.request("cron.manage", params, 15_000);
  } finally {
    client.close();
  }
}

export function jobsFromCronResult(result: unknown): CronJobView[] {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const jobs = (result as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.filter((job): job is CronJobView => Boolean(job) && typeof job === "object");
}
