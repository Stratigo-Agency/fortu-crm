// A small in-memory limiter: `limit` hits per `windowMs` per key. Used by /go/wa, /api/v1/* and the password sign-in.
// It lives in one process. That is enough while the CRM runs as a single `web` instance; with more
// than one instance each keeps its own count, so the real limit becomes limit x instances.
// Counts reset when the service restarts (a deploy), which is fine for abuse limits.

export type RateLimiter = {
  /** Counts one hit; false when the key is over the limit (the hit is not counted then). */
  hit(key: string, nowMs?: number): boolean;
  /** True while the key still has room. Counts nothing. */
  allows(key: string, nowMs?: number): boolean;
  /** Hits inside the window for the key. Counts nothing. */
  count(key: string, nowMs?: number): number;
  /** Takes back the most recent hit of the key (to give a reserved slot back). */
  release(key: string): void;
};

export function createRateLimiter(limit: number, windowMs: number, maxKeys = 5000): RateLimiter {
  const seen = new Map<string, number[]>(); // insertion order = least recently used first
  const recentOf = (key: string, nowMs: number) => (seen.get(key) ?? []).filter((t) => t > nowMs - windowMs);
  return {
    allows: (key, nowMs = Date.now()) => recentOf(key, nowMs).length < limit,
    count: (key, nowMs = Date.now()) => recentOf(key, nowMs).length,
    release(key) {
      const list = seen.get(key);
      if (!list) return;
      list.pop();
      if (list.length === 0) seen.delete(key);
    },
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

let warnedNoIp = false;

/**
 * The visitor's address. The proxy in front of us (Railway) appends the address it saw to x-forwarded-for,
 * so the LAST entry is the one we can trust; the first entries are whatever the visitor sent.
 * Returns "unknown" when no header carries an address; that is logged once, because it means the proxy
 * header is not what we assume (docs/deploy.md · "Check the client address"). Callers that must not lump
 * all such visitors together (password sign-in) check for "unknown" themselves.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  const ip = forwarded?.at(-1) || headers.get("x-real-ip");
  if (ip) return ip;
  if (!warnedNoIp) {
    warnedNoIp = true;
    console.warn("rate limit: request without x-forwarded-for or x-real-ip; all such requests share one 'unknown' address");
  }
  return "unknown";
}
