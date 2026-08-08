import { NextResponse, type NextRequest } from "next/server";
import { validateLoopbackRequest } from "@/core/request-trust";

export function proxy(request: NextRequest) {
  if (!validateLoopbackRequest(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
