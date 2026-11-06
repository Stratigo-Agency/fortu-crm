import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";
import { sql } from "@/lib/db";
import { readCappedBytes } from "@/lib/http/readCapped";
import { clientIp, createRateLimiter } from "@/lib/webform/rateLimit";
import type { WaPayload } from "./payload";
import { prepareEvent, processWebhookEvent, WEBHOOK_PROVIDER } from "./process";

// GET + POST /api/v1/webhooks/whatsapp (docs/INTEGRATIONS.md · WhatsApp Cloud API webhook).
// GET answers Meta's verification request. POST checks X-Hub-Signature-256 (HMAC-SHA256 of the raw body bytes with
// the app secret), trims the event (lib/whatsapp/process.ts prepareEvent: no text, names or address book; nothing at
// all for lines without consent), stores it, answers 200 and processes it afterwards with the text kept in memory;
// jobs/retry-inbound.ts picks up what failed. Bodies are never logged.
//
// Rate limit (same limiter as T22): only failures count. An address that sent 60 bad signatures or verify tokens in
// a minute is refused before its body is read. A correctly signed request is never refused for its volume, so a
// burst from Meta (history sync sends many events at once) always gets through.

const MAX_BODY_BYTES = 3 * 1024 * 1024; // history chunks can be large
const failures = createRateLimiter(60, 60_000);

const noStore = { "cache-control": "no-store" };
const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: noStore });
const tooMany = () => Response.json({ error: "rate_limited" }, { status: 429, headers: { ...noStore, "retry-after": "60" } });

/** Equal strings without leaking where they differ (both hashed first, so lengths need not match). */
function sameSecret(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

/** "sha256=<hex>" for a body: what Meta sends, and what tests send. */
export function signWebhook(secret: string, body: string | Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** The signature is over the exact bytes Meta sent: never decode and re-encode the body before checking. */
export function verifyWebhookSignature(secret: string, header: string | null, body: string | Buffer): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = Buffer.from(signWebhook(secret, body).slice(7), "hex");
  const given = Buffer.from(header.slice(7), "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** GET: hub.mode=subscribe and hub.verify_token = META_VERIFY_TOKEN → the challenge as plain text. */
export function handleVerify(request: Request): Response {
  const ip = clientIp(request.headers);
  if (!failures.allows(ip)) return tooMany();
  const expected = process.env.META_VERIFY_TOKEN;
  const params = new URL(request.url).searchParams;
  const challenge = params.get("hub.challenge") ?? "";
  const ok = Boolean(expected) && params.get("hub.mode") === "subscribe" && sameSecret(params.get("hub.verify_token") ?? "", expected ?? "");
  if (!ok || !/^[\w-]{1,128}$/.test(challenge)) {
    failures.hit(ip);
    return new Response("forbidden", { status: 403, headers: noStore });
  }
  return new Response(challenge, { status: 200, headers: { ...noStore, "content-type": "text/plain" } });
}

type Schedule = (task: () => Promise<unknown>) => void;

/** POST: check, store, answer; `schedule` runs the processing after the response (next/server `after`). */
export async function handleWebhookPost(request: Request, { schedule }: { schedule: Schedule }): Promise<Response> {
  const ip = clientIp(request.headers);
  if (!failures.allows(ip)) return tooMany();

  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.error("whatsapp webhook: META_APP_SECRET is not set");
    return json(500, { error: "server_error" }); // Meta retries; nothing is lost
  }
  const signature = request.headers.get("x-hub-signature-256");
  if (!signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) {
    failures.hit(ip);
    return json(401, { error: "unauthorized" });
  }
  const raw = await readCappedBytes(request, MAX_BODY_BYTES);
  if (raw === null) return json(413, { error: "too_large" });
  if (!verifyWebhookSignature(secret, signature, raw)) {
    failures.hit(ip);
    console.warn("whatsapp webhook: bad signature");
    return json(401, { error: "unauthorized" });
  }

  let payload: WaPayload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return json(400, { error: "bad_request" });
  }
  if (payload?.object !== "whatsapp_business_account") return json(200, { ok: true, ignored: true });

  // Only what processing needs is stored; lines without consent leave nothing behind.
  const prepared = await prepareEvent(payload);
  if (!prepared) return json(200, { ok: true });

  // Meta resends the same body when we were slow: the hash of the body makes the second copy a no-op.
  const externalId = createHash("sha256").update(raw).digest("hex");
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO inbound_events (provider, external_id, payload)
    VALUES (${WEBHOOK_PROVIDER}, ${externalId}, ${sql.json(prepared.stored as postgres.JSONValue)})
    ON CONFLICT (provider, external_id) DO NOTHING
    RETURNING id`;
  if (row) {
    schedule(() => processWebhookEvent(row.id, prepared.transient));
  }
  return json(200, { ok: true });
}
