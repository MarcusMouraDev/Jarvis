import { NextResponse } from "next/server";
import { z } from "zod";
import { summarizePath } from "@/context/path-summary";

export const runtime = "nodejs";

const bodySchema = z.object({
  path: z.string().min(1),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = summarizePath(parsed.path);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  // Never expose absolute path to the client.
  const { absPath: _abs, ...summary } = result;
  void _abs;
  return NextResponse.json({
    summary: { ...summary, absPath: summary.relPath },
  });
}
