import { workspaceRouteError } from "@/core/central-workspace-route";
import {
  loadJarvisSoulPolicy,
  saveJarvisSoulPreferences,
  type JarvisSoulPreferences,
} from "@/core/jarvis-soul";
import { getCoreStore } from "@/core/core-store-runtime";
import { jsonNoStore, readJsonBody } from "@/core/safe-route-response";
import { requireProtectedRequest } from "@/core/session-security";

export const runtime = "nodejs";

function authorize(request: Request) {
  return requireProtectedRequest(request, { store: getCoreStore() });
}

export async function GET(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) return auth.response;
  return jsonNoStore(loadJarvisSoulPolicy());
}

export async function PUT(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) return auth.response;
  try {
    return jsonNoStore(
      saveJarvisSoulPreferences((await readJsonBody(request)) as JarvisSoulPreferences),
    );
  } catch (error) {
    return workspaceRouteError(error);
  }
}
