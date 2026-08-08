import { z } from "zod";
import { appendMessage, searchMessages } from "@/core/history-store";

export const runtime = "nodejs";

const postSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  text: z.string().min(1),
  meta: z.string().optional(),
  runId: z.string().optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "50");

  const messages = searchMessages({
    q,
    limit: Number.isFinite(limit) ? limit : 50,
  });

  return Response.json({ count: messages.length, messages });
}

export async function POST(req: Request) {
  let parsed: z.infer<typeof postSchema>;
  try {
    parsed = postSchema.parse(await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const message = appendMessage(parsed);
  return Response.json({ message }, { status: 201 });
}
