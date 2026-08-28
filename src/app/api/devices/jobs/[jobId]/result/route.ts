import { getCompanionStore, readCompanionToken } from "@/core/companion-runtime";
import { workspaceRouteError } from "@/core/central-workspace-route";
import { jsonNoStore, readJsonBody } from "@/core/safe-route-response";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const body = (await readJsonBody(request)) as { nonce?: string; result?: unknown };
    if (!body.nonce) throw new Error("job_nonce_required");
    return jsonNoStore(
      getCompanionStore().completeJob(
        readCompanionToken(request),
        (await context.params).jobId,
        body.nonce,
        body.result,
      ),
    );
  } catch (error) {
    return workspaceRouteError(error);
  }
}
