import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { openCoreStore } from "@/core/core-store";
import { getSafeCoreRuntime } from "@/core/safe-core-runtime";
import {
  jsonNoStore,
  readJsonBody,
  safeRouteError,
} from "@/core/safe-route-response";
import {
  SESSION_COOKIE_NAME,
  requireProtectedRequest,
  validateTrustedWebRequest,
} from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";

export const runtime = "nodejs";

const SESSION_MAX_AGE_SECONDS = 86_400;
const DEVICE_MAX_AGE_SECONDS = 31_536_000;
const DEVICE_COOKIE_NAME = "jarvis_device";

function cookieValue(request: Request, name: string): string | null {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  return values.length === 1 && values[0] ? values[0] : null;
}

export async function GET(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return NextResponse.json({ error: "safe_core_disabled" }, { status: 404 });
  }
  if (!validateTrustedWebRequest(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const store = openCoreStore();
  const identityLogin = request.headers
    .get("tailscale-user-login")
    ?.trim()
    .toLowerCase();
  let deviceId: string | undefined;
  if (identityLogin) {
    const suppliedDeviceId = cookieValue(request, DEVICE_COOKIE_NAME);
    const existing = suppliedDeviceId ? store.getDevice(suppliedDeviceId) : null;
    if (
      existing &&
      (existing.status !== "active" || existing.identityLogin !== identityLogin)
    ) {
      return NextResponse.json({ error: "device_revoked" }, { status: 401 });
    }
    if (existing) {
      deviceId = existing.deviceId;
      store.touchDevice(deviceId);
    } else {
      const userAgent = request.headers.get("user-agent") ?? "";
      const mobile = /iPhone|iPad/i.test(userAgent);
      deviceId = store.createDevice({
        identityLogin,
        label: mobile ? "iPhone/iPad PWA" : "Jarvis web",
        kind: mobile ? "pwa" : "web",
      }).deviceId;
    }
  }

  const sessionId = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + SESSION_MAX_AGE_SECONDS * 1_000,
  ).toISOString();

  store.createSafeSession({
    sessionId,
    csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
    defaultAgentId: "Hermes",
    expiresAt,
    createdAt: createdAt.toISOString(),
    lastSeenAt: createdAt.toISOString(),
    ...(deviceId && identityLogin ? { deviceId, identityLogin } : {}),
  });

  const response = NextResponse.json({
    csrfToken,
    defaultAgentId: "Hermes",
    expiresAt,
    deviceId: deviceId ?? null,
  });
  const secure = Boolean(identityLogin) || new URL(request.url).protocol === "https:";
  response.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  if (deviceId) {
    response.cookies.set(DEVICE_COOKIE_NAME, deviceId, {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: DEVICE_MAX_AGE_SECONDS,
    });
  }
  return response;
}

export async function PATCH(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const core = getSafeCoreRuntime();
  const auth = requireProtectedRequest(request, { store: core.store });
  if (!auth.ok) return auth.response;
  try {
    const updated = core.service.updateDefaultAgent(
      auth.session,
      await readJsonBody(request),
    );
    return jsonNoStore({ defaultAgentId: updated.defaultAgentId });
  } catch (error) {
    return safeRouteError(error);
  }
}
