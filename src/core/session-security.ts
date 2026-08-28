import { createHash, timingSafeEqual } from "node:crypto";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";
import { openCoreStore, type CoreSession, type CoreStore } from "./core-store";
import { validateTrustedWebRequest } from "./request-trust";

export {
  validateInternalServiceRequest,
  validateLoopbackRequest,
  validateTailscaleServeRequest,
  validateTrustedWebRequest,
} from "./request-trust";

export const SESSION_COOKIE_NAME = "jarvis_session";
export const CSRF_HEADER_NAME = "X-Jarvis-CSRF";

function readCookie(request: Request, name: string): string | null {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  return values.length === 1 && values[0] ? values[0] : null;
}

function csrfMatches(token: string | null, expectedHash: string | null): boolean {
  const actual = createHash("sha256").update(token ?? "").digest();
  const expected = /^[a-f\d]{64}$/i.test(expectedHash ?? "")
    ? Buffer.from(expectedHash!, "hex")
    : Buffer.alloc(32);
  return timingSafeEqual(actual, expected);
}

export type ProtectedRequestResult =
  | { ok: true; session: CoreSession }
  | { ok: false; response: Response };

export function requireProtectedRequest(
  request: Request,
  options: { store?: CoreStore; now?: Date } = {},
): ProtectedRequestResult {
  if (!isSafeAgentCoreEnabled()) {
    return {
      ok: false,
      response: Response.json({ error: "safe_core_disabled" }, { status: 404 }),
    };
  }
  if (!validateTrustedWebRequest(request)) {
    return {
      ok: false,
      response: Response.json({ error: "forbidden" }, { status: 403 }),
    };
  }

  const store = options.store ?? openCoreStore();
  const session = store.getSession(readCookie(request, SESSION_COOKIE_NAME) ?? "");
  const csrfToken = request.headers.get(CSRF_HEADER_NAME);
  const now = options.now ?? new Date();
  const csrfValid = csrfMatches(csrfToken, session?.csrfHash ?? null);
  const device = session?.deviceId ? store.getDevice(session.deviceId) : null;
  const deviceValid =
    session?.deviceId === null ||
    (device?.status === "active" &&
      device.identityLogin === session?.identityLogin);
  const authenticated =
    session !== null &&
    session.expiresAt !== null &&
    Date.parse(session.expiresAt) > now.getTime() &&
    csrfValid &&
    deviceValid;

  if (!authenticated) {
    return {
      ok: false,
      response: Response.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  store.updateSessionLastSeen(session.sessionId, now.toISOString());
  if (session.deviceId) store.touchDevice(session.deviceId, now.toISOString());
  return {
    ok: true,
    session: { ...session, lastSeenAt: now.toISOString() },
  };
}
