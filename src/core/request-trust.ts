interface RequestHost {
  host: string;
  hostname: string;
}

function parseRequestHost(value: string | null): RequestHost | null {
  if (!value) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return {
      host: parsed.host,
      hostname: parsed.hostname.replace(/^\[|\]$/g, ""),
    };
  } catch {
    return null;
  }
}

export function validateLoopbackRequest(request: Request): boolean {
  const requestHost = parseRequestHost(request.headers.get("host"));
  if (
    !requestHost ||
    !["localhost", "127.0.0.1", "::1"].includes(requestHost.hostname)
  ) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash &&
      parsed.host === requestHost.host
    );
  } catch {
    return false;
  }
}

export function validateInternalServiceRequest(
  request: Request,
  configuredHosts = process.env.JARVIS_INTERNAL_HOSTS ?? "",
): boolean {
  if (request.headers.get("origin") !== null) return false;
  const requestHost = parseRequestHost(request.headers.get("host"));
  if (!requestHost) return false;

  const allowedHosts = configuredHosts
    .split(",")
    .map((value) => parseRequestHost(value.trim())?.host.toLowerCase())
    .filter((value): value is string => Boolean(value));
  return allowedHosts.includes(requestHost.host.toLowerCase());
}

export interface TailscaleTrustOptions {
  enabled?: string;
  hosts?: string;
  logins?: string;
}

export function validateTailscaleServeRequest(
  request: Request,
  options: TailscaleTrustOptions = {},
): boolean {
  const enabled = options.enabled ?? process.env.JARVIS_TRUST_TAILSCALE_HEADERS;
  if (enabled !== "1") return false;

  const requestHost = parseRequestHost(request.headers.get("host"));
  if (!requestHost) return false;
  const allowedHosts = (options.hosts ?? process.env.JARVIS_TAILSCALE_HOSTS ?? "")
    .split(",")
    .map((value) => parseRequestHost(value.trim())?.host.toLowerCase())
    .filter((value): value is string => Boolean(value));
  if (!allowedHosts.includes(requestHost.host.toLowerCase())) return false;

  const login = request.headers.get("tailscale-user-login")?.trim().toLowerCase();
  if (!login) return false;
  const allowedLogins = (
    options.logins ?? process.env.JARVIS_TAILSCALE_LOGIN_ALLOWLIST ?? ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedLogins.includes(login)) return false;

  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash &&
      parsed.host.toLowerCase() === requestHost.host.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function validateTrustedWebRequest(request: Request): boolean {
  return validateLoopbackRequest(request) || validateTailscaleServeRequest(request);
}
