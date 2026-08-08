import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { openCoreStore } from "@/core/core-store";
import {
  SESSION_COOKIE_NAME,
  validateLoopbackRequest,
} from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";

export const runtime = "nodejs";

const SESSION_MAX_AGE_SECONDS = 86_400;

export async function GET(request: Request) {
  if (!isSafeAgentCoreEnabled()) {
    return NextResponse.json({ error: "safe_core_disabled" }, { status: 404 });
  }
  if (!validateLoopbackRequest(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sessionId = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + SESSION_MAX_AGE_SECONDS * 1_000,
  ).toISOString();

  openCoreStore().createSafeSession({
    sessionId,
    csrfHash: createHash("sha256").update(csrfToken).digest("hex"),
    defaultAgentId: "Hermes",
    expiresAt,
    createdAt: createdAt.toISOString(),
    lastSeenAt: createdAt.toISOString(),
  });

  const response = NextResponse.json({
    csrfToken,
    defaultAgentId: "Hermes",
    expiresAt,
  });
  response.headers.set(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${
      new URL(request.url).protocol === "https:" ? "; Secure" : ""
    }`,
  );
  return response;
}
