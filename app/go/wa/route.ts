import { NextResponse } from "next/server";
import { clientIp, createRateLimiter } from "@/lib/webform/rateLimit";
import { isBot, parseClick, plainTarget, recordClick } from "@/lib/webform/waLink";

// 20 clicks a minute per IP, and 600 a minute in all. In memory, so per instance (see lib/webform/rateLimit.ts).
const perIp = createRateLimiter(20, 60_000);
const overall = createRateLimiter(600, 60_000, 1);

const noStore = { "cache-control": "no-store" };

/**
 * GET /go/wa?line=<label>&text=<prefill>&utm_*=…  →  302 to wa.me with the prefilled text and a click code.
 * An unknown or inactive line is 404; over the rate limit is 429. A HEAD request or a crawler (a link preview)
 * is sent to the same chat without a code and records nothing.
 */
export async function GET(request: Request) {
  if (!perIp.hit(clientIp(request.headers)) || !overall.hit("all")) {
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
  // HEAD reads the database too, so it shares the same limits as GET.
  if (!perIp.hit(clientIp(request.headers)) || !overall.hit("all")) {
    return new NextResponse(null, { status: 429, headers: { ...noStore, "retry-after": "60" } });
  }
  const click = parseClick(new URL(request.url), request.headers.get("referer"));
  const target = await plainTarget(click).catch(() => null);
  if (!target) return new NextResponse(null, { status: 404, headers: noStore });
  return NextResponse.redirect(target, { status: 302, headers: noStore });
}
