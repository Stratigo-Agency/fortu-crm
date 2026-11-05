import { randomInt } from "node:crypto";
import { sql } from "@/lib/db";

// /go/wa: a tracked WhatsApp link. Each click gets a 4-character code that goes into the prefilled
// message, so a lead that arrives from it can be matched to the page and campaign (docs/INTEGRATIONS.md).

// no 0/O/1/I: easy to misread when a person types it from a screenshot
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const DEFAULT_TEXT = "Halo Fortu, saya mau tanya produknya.";

export function newRefCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

const clip = (v: string | null | undefined, max: number) => v?.trim().slice(0, max) || null;

export type Click = {
  line: string | null;
  text: string | null;
  utm: { source: string | null; medium: string | null; campaign: string | null; content: string | null };
  referrer: string | null;
};

/** Reads the link's query and the referrer; everything is trimmed and capped. */
export function parseClick(url: URL, referrer: string | null): Click {
  const q = (k: string, max: number) => clip(url.searchParams.get(k), max);
  return {
    line: q("line", 60),
    text: q("text", 300),
    utm: { source: q("utm_source", 100), medium: q("utm_medium", 100), campaign: q("utm_campaign", 100), content: q("utm_content", 100) },
    referrer: clip(referrer, 500),
  };
}

/** The wa.me address with the prefilled text and the click code at its end. */
export function waUrl(phoneE164: string, text: string | null, code: string): string {
  return `https://wa.me/${phoneE164.replace(/\D/g, "")}?text=${encodeURIComponent(`${text ?? DEFAULT_TEXT} #${code}`)}`;
}

/** Records the click and returns the WhatsApp address, or null for a line that doesn't exist or is off. */
export async function recordClick(click: Click): Promise<string | null> {
  if (!click.line) return null;
  const [line] = await sql<{ phone_e164: string; user_id: string | null }[]>`
    SELECT phone_e164, user_id FROM wa_lines
     WHERE lower(label) = lower(${click.line}) AND is_active
     ORDER BY id LIMIT 1`;
  if (!line) return null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newRefCode();
    const rows = await sql`
      INSERT INTO wa_click_events (ref_code, source_channel, utm_source, utm_medium, utm_campaign, utm_content, landing_url, target_user_id)
      VALUES (${code}, 'website_wa_link', ${click.utm.source}, ${click.utm.medium}, ${click.utm.campaign}, ${click.utm.content},
              ${click.referrer}, ${line.user_id})
      ON CONFLICT (ref_code) DO NOTHING RETURNING id`;
    if (rows.length > 0) return waUrl(line.phone_e164, click.text, code);
  }
  throw new Error("could not find a free click code");
}
