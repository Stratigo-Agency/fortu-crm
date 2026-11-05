import { z } from "zod";
import type { LeadInput } from "@/lib/ingest/ingestLead";

// The JSON body the website sends (docs/INTEGRATIONS.md · Website form).
// Text fields are trimmed and capped; missing or null optional fields are fine.

const text = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => v || undefined);

export const webFormSchema = z.object({
  submission_id: z.string().uuid(),
  submitted_at: text(40),
  name: text(120),
  phone: z.string().trim().min(5).max(40),
  email: text(200),
  company: text(200),
  product_interest: text(10),
  message: text(2000),
  page_url: text(500),
  utm: z
    .object({ source: text(100), medium: text(100), campaign: text(100), content: text(100) })
    .partial()
    .nullish(),
  click_ids: z.object({ gclid: text(200), fbclid: text(200) }).partial().nullish(),
});

export type WebFormBody = z.infer<typeof webFormSchema>;

const PRODUCTS = ["IFP", "DSS", "LED"] as const;
const FUTURE_MS = 5 * 60_000;

/** The ingestLead() input for a form submission. */
export function toLeadInput(body: WebFormBody, rawPayload: unknown, nowMs: number = Date.now()): LeadInput {
  const product = body.product_interest?.toUpperCase();
  // A browser clock that runs ahead must not make the whole submission fail: use the arrival time instead.
  const at = body.submitted_at ? Date.parse(body.submitted_at) : Number.NaN;
  const usable = Number.isFinite(at) && at <= nowMs + FUTURE_MS;
  return {
    phone: body.phone,
    name: body.name,
    company: body.company,
    sourceChannel: "website_form",
    captureMethod: "web_form",
    firstMessage: body.message,
    productInterest: PRODUCTS.find((p) => p === product),
    utm: {
      ...(body.utm?.source && { source: body.utm.source }),
      ...(body.utm?.medium && { medium: body.utm.medium }),
      ...(body.utm?.campaign && { campaign: body.utm.campaign }),
      ...(body.utm?.content && { content: body.utm.content }),
    },
    receivedAt: usable ? new Date(at).toISOString() : undefined,
    external: { provider: "web_form", id: body.submission_id, payload: rawPayload },
  };
}
