import { NextResponse, type NextRequest } from "next/server";
import {
  validateInternalServiceRequest,
  validateLoopbackRequest,
  validateTailscaleServeRequest,
} from "@/core/request-trust";

export function proxy(request: NextRequest) {
  const internalBroker = request.nextUrl.pathname.startsWith(
    "/api/internal/hermes/",
  );
  const trusted = internalBroker
    ? validateLoopbackRequest(request) || validateInternalServiceRequest(request)
    : validateLoopbackRequest(request) || validateTailscaleServeRequest(request);
  if (!trusted) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
