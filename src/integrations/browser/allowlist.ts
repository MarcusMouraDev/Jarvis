const DEFAULT_ALLOWLIST = ["example.com", "localhost", "127.0.0.1"];

export const MAX_BROWSER_STEPS = 15;
export const DEFAULT_BROWSER_TIMEOUT_MS = 20_000;

export function getBrowserAllowlist(): string[] {
  const raw = process.env.JARVIS_BROWSER_ALLOWLIST?.trim();
  if (!raw) return DEFAULT_ALLOWLIST;
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function isDomainAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const allowlist = getBrowserAllowlist();
    return allowlist.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}
