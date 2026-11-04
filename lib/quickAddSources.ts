import type { SourceChannel } from "@/lib/ingest/ingestLead";

/** Sources a rep can pick in Tambah cepat when the message has no code. The first is the default (an ad chat). */
export const QUICK_ADD_SOURCES = [
  "meta_ctwa", "whatsapp_direct", "instagram_dm", "website_wa_link", "google_ads", "referral",
  "partner_si", "repeat_order", "event", "walk_in", "tender", "other",
] as const satisfies readonly SourceChannel[];

export type QuickAddSource = (typeof QUICK_ADD_SOURCES)[number];
