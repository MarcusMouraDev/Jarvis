import { NextResponse } from "next/server";
import { indexPaths } from "@/context/path-index";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const paths = indexPaths(q, undefined, 40);
  return NextResponse.json({ paths });
}
