import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { compileJarvisSystemInstruction, loadJarvisSoulPolicy } from "@/core/jarvis-soul";

export const runtime = "nodejs";

function brokerAuthorized(request: Request): boolean {
  const expected =
    process.env.HERMES_BROKER_TOKEN?.trim() || process.env.HERMES_MODEL_BROKER_TOKEN?.trim();
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

function correlationId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.JARVIS_BROKER_ENABLED !== "1") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!brokerAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: "messages_required" }, { status: 400 });
  }
  const policy = loadJarvisSoulPolicy();
  const requestId = correlationId(request);
  const base = (process.env.LOCAL_OPENAI_BASE_URL ?? "http://omniroute:20128").replace(/\/+$/, "");
  const upstreamBody = {
    ...body,
    // Hermes cannot select a provider/model. Jarvis owns this alias and fallback policy.
    model: process.env.JARVIS_HERMES_MODEL_ALIAS?.trim() || "local",
    metadata: {
      ...(body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {}),
      jarvis_soul_policy_version: policy.version,
      jarvis_soul_digest: policy.digest,
      jarvis_correlation_id: requestId,
    },
    messages: [
      { role: "system", content: compileJarvisSystemInstruction(policy) },
      ...body.messages,
    ],
  };
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-request-id": requestId,
  };
  const key = process.env.LOCAL_OPENAI_API_KEY?.trim();
  if (key && key !== "not-needed") headers.authorization = `Bearer ${key}`;
  try {
    const upstream = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(120_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "broker_unavailable", requestId },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }
}
