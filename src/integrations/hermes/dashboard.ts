import { readHermesToken } from "./health";
import { hermesGatewayHttp } from "./profile";

export async function fetchHermesDashboard(
  path: string,
  init: RequestInit = {},
  timeoutMs = 2_500,
): Promise<Response> {
  const token = await readHermesToken();
  const base = hermesGatewayHttp().replace(/\/$/, "");
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("X-Hermes-Session-Token", token);
  }
  return fetch(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

export async function fetchHermesJson<T>(
  path: string,
  timeoutMs = 2_500,
): Promise<T | null> {
  try {
    const response = await fetchHermesDashboard(path, {}, timeoutMs);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
