import { NextResponse } from "next/server";
import { z } from "zod";
import { isMemoryEnabled } from "@/memory/flags";
import {
  createMemory,
  deleteMemory,
  expireMemory,
  getMemory,
  listMemories,
  updateMemory,
} from "@/memory/memory-service";

export const runtime = "nodejs";

function disabled() {
  return NextResponse.json({ error: "memory_disabled" }, { status: 404 });
}

const createSchema = z.object({
  kind: z.string().min(1).max(64),
  content: z.string().min(1).max(16_000),
  summary: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  consent: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
});

const updateSchema = createSchema
  .partial()
  .extend({ id: z.string().min(1) });

export async function GET(req: Request) {
  if (!isMemoryEnabled()) return disabled();

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const memory = getMemory(id);
    if (!memory) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ memory });
  }

  const limit = Number(url.searchParams.get("limit") ?? "100");
  return NextResponse.json({
    count: listMemories(Number.isFinite(limit) ? limit : 100).length,
    memories: listMemories(Number.isFinite(limit) ? limit : 100),
  });
}

export async function POST(req: Request) {
  if (!isMemoryEnabled()) return disabled();

  let parsed: z.infer<typeof createSchema>;
  try {
    parsed = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const memory = createMemory(parsed);
  return NextResponse.json({ memory }, { status: 201 });
}

export async function PATCH(req: Request) {
  if (!isMemoryEnabled()) return disabled();

  let parsed: z.infer<typeof updateSchema>;
  try {
    parsed = updateSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id, ...patch } = parsed;
  const memory = updateMemory(id, patch);
  if (!memory) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ memory });
}

export async function DELETE(req: Request) {
  if (!isMemoryEnabled()) return disabled();

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  if (!deleteMemory(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
  if (!isMemoryEnabled()) return disabled();

  let body: { id?: string; action?: string };
  try {
    body = (await req.json()) as { id?: string; action?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (body.action === "expire" && body.id) {
    const memory = expireMemory(body.id);
    if (!memory) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ memory });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
