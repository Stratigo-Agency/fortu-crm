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

/** A visitor's text can't carry an attribution code of its own (#W7K2, [F-IFP-01]): the CRM reads the first one it finds. */
export function neutralizeCodes(text: string): string {
  return text.replace(/#(?=[A-Z0-9]{4}\b)/gi, "").replace(/\[([A-Z]-(?:IFP|DSS|LED)-\d{2})\]/gi, "($1)");
}

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
    line: q("line", 300),
    text: ((t) => (t ? neutralizeCodes(t) : null))(q("text", 300)),
    utm: { source: q("utm_source", 100), medium: q("utm_medium", 100), campaign: q("utm_campaign", 100), content: q("utm_content", 100) },
    referrer: clip(referrer, 500),
  };
}

/** The wa.me address with the prefilled text and the click code at its end. */
export function waUrl(phoneE164: string, text: string | null, code: string | null): string {
  const message = code ? `${text ?? DEFAULT_TEXT} #${code}` : (text ?? DEFAULT_TEXT);
  return `https://wa.me/${phoneE164.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

/** Link-preview fetchers and crawlers: they follow the link but are not a visitor, so they get no click code. */
export function isBot(userAgent: string | null): boolean {
  return !userAgent || /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|skype|curl|wget|python-requests|headless/i.test(userAgent);
}

/**
 * "Jakarta-1, Jakarta-2" → ["jakarta-1", "jakarta-2"]: up to 10 labels, case does not matter.
 * The whole text also counts as one label, so an existing label that holds a comma still works.
 */
export function lineLabels(line: string | null): string[] {
  if (!line?.trim()) return [];
  const whole = line.trim().toLowerCase();
  const parts = line.split(",").map((l) => l.trim().toLowerCase()).filter(Boolean);
  return [...new Set([whole, ...parts])].slice(0, 11);
}

/**
 * The line to send this click to. `line` is one label or a comma-separated group (a team's numbers).
 * A label that matches the whole text wins. Otherwise, among the group's active lines, a line whose rep is
 * active and taking leads comes first (a line without a rep, such as an office number, only when none is);
 * the rest is picked at random, so a team's chats spread over its numbers.
 */
async function findLine(line: string | null) {
  const labels = lineLabels(line);
  if (labels.length === 0) return null;
  const [found] = await sql<{ phone_e164: string; user_id: string | null }[]>`
    SELECT l.phone_e164, l.user_id
      FROM wa_lines l
      LEFT JOIN users u ON u.id = l.user_id
     WHERE lower(l.label) = ANY(${labels}::text[]) AND l.is_active
     ORDER BY lower(l.label) = ${labels[0]} DESC, (u.is_active AND u.accepting_leads) IS TRUE DESC, random()
     LIMIT 1`;
  return found ?? null;
}

/** The plain WhatsApp chat address (no code), for a HEAD request or a crawler. Null when the line is unknown or off. */
export async function plainTarget(click: Click): Promise<string | null> {
  const line = await findLine(click.line);
  return line ? waUrl(line.phone_e164, click.text, null) : null;
}

/** Records the click and returns the WhatsApp address, or null for a line that doesn't exist or is off. */
export async function recordClick(click: Click): Promise<string | null> {
  const line = await findLine(click.line);
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
