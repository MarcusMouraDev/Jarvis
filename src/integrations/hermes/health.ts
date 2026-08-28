import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HermesHealth {
  gateway: "up" | "down";
  detail?: string;
}

function tokenPath(): string {
  return (
    process.env.HERMES_TOKEN_FILE ??
    join(
      process.env.XDG_CACHE_HOME ?? join(homedir(), "Library/Caches"),
      "jarvis",
      "hermes.session-token",
    )
  );
}

export async function readHermesToken(): Promise<string> {
  if (process.env.HERMES_GATEWAY_TOKEN) return process.env.HERMES_GATEWAY_TOKEN;
  if (process.env.HERMES_DASHBOARD_SESSION_TOKEN) {
    return process.env.HERMES_DASHBOARD_SESSION_TOKEN;
  }
  try {
    return (await readFile(/* turbopackIgnore: true */ tokenPath(), "utf8")).trim();
  } catch {
    return "";
  }
}

export async function probeHermesHealth(): Promise<HermesHealth> {
  const url = process.env.HERMES_GATEWAY_HTTP ?? "http://127.0.0.1:9119/";
  try {
    const token = await readHermesToken();
    const response = await fetch(url, {
      headers: token ? { "X-Hermes-Session-Token": token } : undefined,
      signal: AbortSignal.timeout(1500),
    });
    // Headless `hermes serve` answers 404 on `/` with UI disabled; that still means the gateway is up.
    return { gateway: "up", detail: response.ok ? undefined : `http_${response.status}` };
  } catch (error) {
    return {
      gateway: "down",
      detail: error instanceof Error ? error.message : "unreachable",
    };
  }
}
