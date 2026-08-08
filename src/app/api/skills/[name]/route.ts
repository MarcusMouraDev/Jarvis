import { NextResponse } from "next/server";
import { loadSkill } from "@/skills/catalog";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const skill = loadSkill(decodeURIComponent(name));
  if (!skill) {
    return NextResponse.json({ error: "skill_not_found" }, { status: 404 });
  }
  return NextResponse.json({
    name: skill.name,
    description: skill.description,
    source: skill.source,
    body: skill.body,
  });
}
