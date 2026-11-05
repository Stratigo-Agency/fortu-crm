import { createHmac, timingSafeEqual } from "node:crypto";

// Signed requests from the website's FastAPI backend (docs/INTEGRATIONS.md · Website form).
// signature = HMAC-SHA256(secret, `${timestamp}.${rawBody}`), sent as "sha256=<hex>".

export const MAX_SKEW_SECONDS = 300;

export type SignatureResult = { ok: true } | { ok: false; reason: "missing" | "format" | "stale" | "mismatch" };

/** Computes the header value a sender must send. Used by tests and scripts/sign-webform.mjs. */
export function sign(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verifySignature(
  secret: string,
  headers: { timestamp: string | null; signature: string | null },
  body: string,
  nowMs: number = Date.now(),
): SignatureResult {
  const { timestamp, signature } = headers;
  if (!timestamp || !signature) return { ok: false, reason: "missing" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "format" };
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale" };
  if (!/^sha256=[0-9a-f]{64}$/i.test(signature)) return { ok: false, reason: "format" };
  const expected = Buffer.from(sign(secret, timestamp, body).slice(7), "hex");
  const given = Buffer.from(signature.slice(7), "hex");
  // both are 32 bytes here, which timingSafeEqual requires
  return expected.length === given.length && timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: "mismatch" };
}
