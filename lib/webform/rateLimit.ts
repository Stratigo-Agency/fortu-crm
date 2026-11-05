// A small in-memory limiter for /go/wa: `limit` hits per `windowMs` per key.
// It lives in one process. That is enough while the CRM runs as a single `web` instance; with more
// than one instance each keeps its own count, so the real limit becomes limit × instances.

export type RateLimiter = { hit(key: string, nowMs?: number): boolean };

export function createRateLimiter(limit: number, windowMs: number, maxKeys = 5000): RateLimiter {
  const seen = new Map<string, number[]>(); // insertion order = least recently used first
  return {
    hit(key, nowMs = Date.now()) {
      const recent = (seen.get(key) ?? []).filter((t) => t > nowMs - windowMs);
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
