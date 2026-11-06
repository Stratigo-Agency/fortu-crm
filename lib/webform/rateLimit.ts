// A small in-memory limiter: `limit` hits per `windowMs` per key. Used by /go/wa, /api/v1/* and the password sign-in.
// It lives in one process. That is enough while the CRM runs as a single `web` instance; with more
// than one instance each keeps its own count, so the real limit becomes limit x instances.
// Counts reset when the service restarts (a deploy), which is fine for abuse limits.

export type RateLimiter = {
  /** Counts one hit; false when the key is over the limit (the hit is not counted then). */
  hit(key: string, nowMs?: number): boolean;
  /** True while the key still has room. Counts nothing. */
  allows(key: string, nowMs?: number): boolean;
};

export function createRateLimiter(limit: number, windowMs: number, maxKeys = 5000): RateLimiter {
  const seen = new Map<string, number[]>(); // insertion order = least recently used first
  const recentOf = (key: string, nowMs: number) => (seen.get(key) ?? []).filter((t) => t > nowMs - windowMs);
  return {
    allows: (key, nowMs = Date.now()) => recentOf(key, nowMs).length < limit,
    hit(key, nowMs = Date.now()) {
      const recent = recentOf(key, nowMs);
      seen.delete(key);
      if (recent.length >= limit) {
        seen.set(key, recent);
        return false;
      }
      recent.push(nowMs);
      seen.set(key, recent);
      if (seen.size > maxKeys) seen.delete(seen.keys().next().value as string);
      return true;
    },
  };
}

/**
 * The visitor's address. The proxy in front of us (Railway) appends the address it saw to x-forwarded-for,
 * so the LAST entry is the one we can trust; the first entries are whatever the visitor sent.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) || headers.get("x-real-ip") || "unknown";
}
