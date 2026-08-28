import { getCompanionStore } from "@/core/companion-runtime";
import { getCoreStore } from "@/core/core-store-runtime";
import { jsonNoStore, readJsonBody } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";
import { workspaceRouteError } from "@/core/central-workspace-route";
import { validateTrustedWebRequest } from "@/core/request-trust";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!validateTrustedWebRequest(request)) {
      return jsonNoStore({ error: "untrusted_request" }, { status: 403 });
    }
    const body = (await readJsonBody(request)) as {
      mode?: "create" | "redeem";
      code?: string;
      label?: string;
      capabilities?: string[];
    };
    const companions = getCompanionStore();
    if (body.mode === "redeem") {
      const identityLogin = request.headers.get("tailscale-user-login") ?? undefined;
      return jsonNoStore(
        companions.redeemPairingCode(body.code ?? "", {
          label: body.label ?? "Mac companion",
          capabilities: body.capabilities ?? [],
        }, identityLogin),
        { status: 201 },
      );
    }
    const auth = requireProtectedRequest(request, { store: getCoreStore() });
    if (!auth.ok) return auth.response;
    if (!auth.session.identityLogin) throw new Error("tailscale_identity_required");
    return jsonNoStore(companions.createPairingCode(auth.session.identityLogin), { status: 201 });
  } catch (error) {
    return workspaceRouteError(error);
  }
}
