import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/webform/rateLimit";
import { isBot, parseClick, plainTarget, recordClick } from "@/lib/webform/waLink";

// 20 clicks a minute per IP, and 600 a minute in all. In memory, so per instance (see lib/webform/rateLimit.ts).
const perIp = createRateLimiter(20, 60_000);
const overall = createRateLimiter(600, 60_000, 1);

function clientIp(request: Request): string {
  // The proxy in front of us appends the address it saw to x-forwarded-for, so the LAST entry is the one
  // we can trust. The first entries are whatever the visitor sent.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) || request.headers.get("x-real-ip") || "unknown";
}

const noStore = { "cache-control": "no-store" };

/**
 * GET /go/wa?line=<label>&text=<prefill>&utm_*=…  →  302 to wa.me with the prefilled text and a click code.
 * An unknown or inactive line is 404; over the rate limit is 429. A HEAD request or a crawler (a link preview)
 * is sent to the same chat without a code and records nothing.
 */
export async function GET(request: Request) {
  if (!perIp.hit(clientIp(request)) || !overall.hit("all")) {
    return new NextResponse("Too many requests", { status: 429, headers: { ...noStore, "retry-after": "60" } });
  }
  const click = parseClick(new URL(request.url), request.headers.get("referer"));
  try {
    const target = isBot(request.headers.get("user-agent")) ? await plainTarget(click) : await recordClick(click);
    if (!target) return new NextResponse("Not found", { status: 404, headers: noStore });
    return NextResponse.redirect(target, { status: 302, headers: noStore });
  } catch (err) {
    console.error("go/wa failed", { name: err instanceof Error ? err.name : "unknown" });
    return new NextResponse("Coba lagi sebentar.", { status: 503, headers: { ...noStore, "retry-after": "5" } });
  }
}

export async function HEAD(request: Request) {
  const click = parseClick(new URL(request.url), request.headers.get("referer"));
  const target = await plainTarget(click).catch(() => null);
  if (!target) return new NextResponse(null, { status: 404, headers: noStore });
  return NextResponse.redirect(target, { status: 302, headers: noStore });
}
