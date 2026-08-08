import { NextResponse } from "next/server";
import { decideApproval, getApproval } from "@/core/run-ledger";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    approvalId?: string;
    decision?: "approved" | "denied";
  } | null;

  if (!body?.approvalId || !body.decision) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const existing = getApproval(body.approvalId);
  if (!existing) {
    return NextResponse.json({ error: "approval_not_found" }, { status: 404 });
  }

  const updated = decideApproval(body.approvalId, body.decision);
  return NextResponse.json({ approval: updated });
}
