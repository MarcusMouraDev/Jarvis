import {
  OMNIROUTE_MCP_TOOL_IDS,
  type OmnirouteMcpToolId,
} from "./manifest";

const ALLOWED = new Set<string>(OMNIROUTE_MCP_TOOL_IDS);

export function isOmnirouteMcpToolAllowed(toolId: string): toolId is OmnirouteMcpToolId {
  return ALLOWED.has(toolId);
}

/** Only loopback hosts are accepted for OmniRoute MCP HTTP. */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export function sanitizeOmnirouteJson(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 4_000 ? `${value.slice(0, 4_000)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeOmnirouteJson(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 80)
        .map(([key, entry]) => [key, sanitizeOmnirouteJson(entry, depth + 1)]),
    );
  }
  return String(value);
}
