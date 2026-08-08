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
