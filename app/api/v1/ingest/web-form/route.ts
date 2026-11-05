import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { InvalidPhoneError } from "@/lib/ingest/errors";
import { ingestLead } from "@/lib/ingest/ingestLead";
import { verifySignature } from "@/lib/webform/signature";
import { toLeadInput, webFormSchema } from "@/lib/webform/schema";

const MAX_BODY_BYTES = 32 * 1024;

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

  // The signature covers the exact bytes sent, so read the raw text first.
  const raw = await request.text();
  const signed = verifySignature(
    secret,
    { timestamp: request.headers.get("x-fortu-timestamp"), signature: request.headers.get("x-fortu-signature") },
    raw,
  );
  if (!signed.ok) {
    console.warn("web-form ingest: rejected", { requestId, reason: signed.reason });
    return reply(401, { error: "unauthorized" });
  }
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return reply(400, { error: "bad_request" });

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
