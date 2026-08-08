import { NextResponse } from "next/server";
import { listSkills } from "@/skills/catalog";

export const runtime = "nodejs";

export async function GET() {
  const skills = listSkills().map(({ name, description, source }) => ({
    name,
    description,
    source,
  }));
  return NextResponse.json({ count: skills.length, skills });
}
