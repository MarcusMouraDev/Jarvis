import { getCentralWorkspaceStore } from "./central-workspace-runtime";
import { getCoreStore } from "./core-store-runtime";
import { jsonNoStore } from "./safe-route-response";
import { requireProtectedRequest } from "./session-security";
import { getCompanionStore, readCompanionToken } from "./companion-runtime";
import type { CompanionCapability } from "./companion-store";

export function requireWorkspaceRequest(
  request: Request,
  companionCapability?: CompanionCapability,
) {
  if ((request.headers.get("authorization") ?? "").startsWith("Bearer jcp_")) {
    try {
      const device = getCompanionStore().authenticate(readCompanionToken(request));
      if (!device || !companionCapability || !device.capabilities.includes(companionCapability)) {
        return { ok: false as const, response: jsonNoStore({ error: "companion_forbidden" }, { status: 403 }) };
      }
      return { ok: true as const, store: getCentralWorkspaceStore(), companion: device };
    } catch {
      return { ok: false as const, response: jsonNoStore({ error: "companion_unauthorized" }, { status: 401 }) };
    }
  }
  const auth = requireProtectedRequest(request, { store: getCoreStore() });
  return auth.ok ? { ok: true as const, store: getCentralWorkspaceStore() } : auth;
}

export function workspaceRouteError(error: unknown): Response {
  const code = error instanceof Error ? error.message : "operation_rejected";
  const status = code.endsWith("_not_found")
    ? 404
    : code === "version_conflict" || code === "chunk_conflict"
      ? 409
      : code === "upload_expired"
        ? 410
        : 400;
  return jsonNoStore({ error: code }, { status });
}
