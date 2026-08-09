import { getSafeCoreRuntime } from "@/core/safe-core-runtime";
import {
  singleStoredEventStream,
  streamStoredEvents,
} from "@/core/safe-event-protocol";
import { jsonNoStore } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { isSafeAgentCoreEnabled } from "@/integrations/flags";

export const runtime = "nodejs";

interface EventsRouteContext {
  params: Promise<{ runId: string }>;
}

function workspacePrivatePaths(workspace: unknown): string[] {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) return [];
  const value = (workspace as { path?: unknown }).path;
  return typeof value === "string" && value ? [value] : [];
}

function streamResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET(request: Request, context: EventsRouteContext) {
  if (!isSafeAgentCoreEnabled()) {
    return jsonNoStore({ error: "safe_core_disabled" }, { status: 404 });
  }
  const core = getSafeCoreRuntime();
  const auth = requireProtectedRequest(request, { store: core.store });
  if (!auth.ok) return auth.response;
  const { runId } = await context.params;
  const run = core.store.getRun(runId);
  if (!run || run.sessionId !== auth.session.sessionId) {
    return jsonNoStore({ error: "run_not_found" }, { status: 404 });
  }

  const privatePaths = workspacePrivatePaths(run.workspace);
  const lastEventId = request.headers.get("Last-Event-ID")?.trim() || null;
  let afterSeq = 0;
  if (lastEventId) {
    const sequence = core.store.sequenceForEvent(runId, lastEventId);
    if (sequence === null) {
      const protocolError = core.store.appendEvent({
        runId,
        type: "protocol.error",
        payload: { code: "invalid_last_event_id" },
      });
      return streamResponse(singleStoredEventStream(protocolError, privatePaths));
    }
    afterSeq = sequence;
  }

  return streamResponse(
    streamStoredEvents({
      store: core.store,
      runId,
      afterSeq,
      signal: request.signal,
      privatePaths,
    }),
  );
}
