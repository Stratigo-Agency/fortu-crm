import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { InvalidPhoneError } from "@/lib/ingest/errors";
import { ingestLead } from "@/lib/ingest/ingestLead";
import { verifySignature } from "@/lib/webform/signature";
import { toLeadInput, webFormSchema } from "@/lib/webform/schema";

const MAX_BODY_BYTES = 32 * 1024;

/** The body as text, or null when it is larger than `max` bytes (checked before and while reading). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * POST /api/v1/ingest/web-form: a lead from the fortu.co.id form, sent by its FastAPI backend.
 * 200 { leadId, deduped } (also for a repeated submission_id) · 400 bad body · 401 bad signature or old timestamp.
 * The body is never logged (it holds a customer's phone number).
 */
export async function POST(request: Request) {
  const requestId = randomUUID();
  const reply = (status: number, json: Record<string, unknown>) =>
    NextResponse.json({ ...json, requestId }, { status, headers: { "cache-control": "no-store" } });

  const secret = process.env.WEBFORM_HMAC_SECRET;
  if (!secret) {
    console.error("web-form ingest: WEBFORM_HMAC_SECRET is not set", { requestId });
    return reply(500, { error: "server_error" });
  }

  const headers = { timestamp: request.headers.get("x-fortu-timestamp"), signature: request.headers.get("x-fortu-signature") };
  const reject = (reason: string) => {
    console.warn("web-form ingest: rejected", { requestId, reason });
    return reply(401, { error: "unauthorized" });
  };
  // Cheap checks first: a request without usable headers or with an old clock never gets its body read.
  const early = verifySignature(secret, headers, "");
  if (!early.ok && early.reason !== "mismatch") return reject(early.reason);

  // The signature covers the exact bytes sent, so read the raw text, but never more than the cap.
  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) return reply(413, { error: "too_large" });
  const signed = verifySignature(secret, headers, raw);
  if (!signed.ok) return reject(signed.reason);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return reply(400, { error: "bad_request" });
  }
  const parsed = webFormSchema.safeParse(json);
  if (!parsed.success) return reply(400, { error: "bad_request", fields: parsed.error.issues.map((i) => i.path.join(".")) });

  try {
    const result = await ingestLead(toLeadInput(parsed.data, json));
    return reply(200, { leadId: result.leadId, deduped: result.deduped });
  } catch (err) {
    if (err instanceof InvalidPhoneError) return reply(400, { error: "bad_request", fields: ["phone"] });
    console.error("web-form ingest failed", { requestId, name: err instanceof Error ? err.name : "unknown" });
    return reply(500, { error: "server_error" });
  }
}
