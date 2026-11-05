import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/webform/rateLimit";
import { parseClick, recordClick } from "@/lib/webform/waLink";

// 20 clicks a minute per IP. In memory, so per instance (see lib/webform/rateLimit.ts).
const limiter = createRateLimiter(20, 60_000);

function clientIp(request: Request): string {
  // Railway puts the visitor first in x-forwarded-for
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/**
 * GET /go/wa?line=<label>&text=<prefill>&utm_*=…  →  302 to wa.me with the prefilled text and a click code.
 * An unknown or inactive line is 404; over 20 a minute from one IP is 429.
 */
export async function GET(request: Request) {
  if (!limiter.hit(clientIp(request))) {
    return new NextResponse("Too many requests", { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } });
  }
  const click = parseClick(new URL(request.url), request.headers.get("referer"));
  const target = await recordClick(click);
  if (!target) return new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return NextResponse.redirect(target, { status: 302, headers: { "cache-control": "no-store" } });
}
