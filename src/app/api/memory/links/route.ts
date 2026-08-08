import { NextResponse } from "next/server";
import { z } from "zod";
import { isMemoryEnabled } from "@/memory/flags";
import {
  createMemoryLink,
  deleteMemoryLink,
  listMemoryLinks,
} from "@/memory/memory-service";

export const runtime = "nodejs";

function disabled() {
  return NextResponse.json({ error: "memory_disabled" }, { status: 404 });
}

const linkSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  relation: z.string().min(1).max(64),
  score: z.number().min(0).max(1).optional(),
  provenance: z.string().max(500).optional(),
});

export async function GET(req: Request) {
  if (!isMemoryEnabled()) return disabled();

  const url = new URL(req.url);
  const source = url.searchParams.get("source") ?? undefined;
  const target = url.searchParams.get("target") ?? undefined;
  const links = listMemoryLinks({ source, target });
  return NextResponse.json({ count: links.length, links });
}

export async function POST(req: Request) {
  if (!isMemoryEnabled()) return disabled();

  let parsed: z.infer<typeof linkSchema>;
  try {
    parsed = linkSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const link = createMemoryLink({
    source: parsed.source,
    target: parsed.target,
    relation: parsed.relation,
    score: parsed.score ?? 0.5,
    provenance: parsed.provenance ?? "",
  });
  return NextResponse.json({ link }, { status: 201 });
}

export async function DELETE(req: Request) {
  if (!isMemoryEnabled()) return disabled();

  const url = new URL(req.url);
  const source = url.searchParams.get("source");
  const target = url.searchParams.get("target");
  const relation = url.searchParams.get("relation");
  if (!source || !target || !relation) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  if (!deleteMemoryLink({ source, target, relation })) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
