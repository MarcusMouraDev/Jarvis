import { fetchHermesDashboard, fetchHermesJson } from "./dashboard";
import { hermesGatewayHttp } from "./profile";

const MUTATE_MS = 15_000;

export interface MessagingEnvVar {
  key: string;
  required?: boolean;
  is_set?: boolean;
  redacted_value?: string | null;
  prompt?: string;
  is_password?: boolean;
}

export interface MessagingPlatformView {
  id: string;
  name: string;
  enabled: boolean;
  configured?: boolean;
  state: string;
  error_message?: string | null;
  env_vars?: MessagingEnvVar[];
}

export interface MessagingPlatformsView {
  dashboardUrl: string;
  platforms: MessagingPlatformView[];
}

export async function listMessagingPlatforms(): Promise<MessagingPlatformsView> {
  const remote = await fetchHermesJson<{ platforms?: MessagingPlatformView[] }>(
    "/api/messaging/platforms",
    MUTATE_MS,
  );
  return {
    dashboardUrl: hermesGatewayHttp(),
    platforms: remote?.platforms ?? [],
  };
}

export async function patchMessagingPlatform(
  id: string,
  body: { enabled?: boolean; env?: Record<string, string> },
): Promise<Response> {
  const safeId = encodeURIComponent(id);
  return fetchHermesDashboard(
    `/api/messaging/platforms/${safeId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    MUTATE_MS,
  );
}

export async function testMessagingPlatform(id: string): Promise<Response> {
  const safeId = encodeURIComponent(id);
  return fetchHermesDashboard(
    `/api/messaging/platforms/${safeId}/test`,
    { method: "POST" },
    MUTATE_MS,
  );
}
