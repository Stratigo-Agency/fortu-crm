import { pgError, sql } from "@/lib/db";

// Ad codes rollout (T18): propose a code like F-IFP-01 for every ad without one, plus the message Nabil
// puts in the ad's WhatsApp prefill. The code is parsed again by lib/ingest/codes.ts when the chat arrives.

export type AdForCode = {
  id: string;
  metaAdId: string;
  name: string;
  campaignName: string;
  adSetName: string;
  adSetLine: string | null;
  ownerName: string | null;
  code: string | null;
  spend30: string;
};

export type CodeProposal = { adId: string; code: string; line: string; message: string };
export type CodeSkip = { adId: string; reason: "noRep" | "noLine" | "full" };

const LINES = ["IFP", "DSS", "LED"] as const;
const PRODUCT: Record<string, string> = { IFP: "smartboard untuk sekolah", DSS: "digital signage", LED: "LED videowall" };

/** "Lead Gen CTWA - No_Frisca - 18/10/26" → "F". Falls back to the owner chosen on the campaign. */
export function repLetter(campaignName: string, ownerName: string | null): string | null {
  const fromName = /No_([A-Za-z])/.exec(campaignName)?.[1];
  const letter = fromName ?? ownerName?.trim()[0];
  return letter && /[A-Za-z]/.test(letter) ? letter.toUpperCase() : null;
}

/** The ad set's product line, or the one its name says ("… DSS50% …" → DSS). */
export function lineOf(adSetLine: string | null, adSetName: string): (typeof LINES)[number] | null {
  if (adSetLine && (LINES as readonly string[]).includes(adSetLine)) return adSetLine as (typeof LINES)[number];
  const hit = /(?:^|[^A-Za-z])(IFP|DSS|LED)(?![A-Za-z])/i.exec(adSetName);
  return hit ? (hit[1].toUpperCase() as (typeof LINES)[number]) : null;
}

export function prefillMessage(line: string, code: string): string {
  return `Halo Fortu, saya mau info ${PRODUCT[line] ?? "produk Fortu"}. [${code}]`;
}

/**
 * Codes for the ads that have none. Numbers continue after the highest one already used for the same
 * rep letter and line, in the order Meta created the ads, so running it twice gives the same answer.
 */
export function proposeCodes(ads: AdForCode[]): { proposals: CodeProposal[]; skipped: CodeSkip[] } {
  const next = new Map<string, number>();
  const used = new Set<string>();
  for (const a of ads) {
    if (!a.code) continue;
    const code = a.code.trim().toUpperCase();
    used.add(code); // any code in use is taken, even one that does not follow the pattern
    const m = /^([A-Z])-(IFP|DSS|LED)-(\d{2})$/.exec(code);
    if (!m) continue;
    const key = `${m[1]}-${m[2]}`;
    next.set(key, Math.max(next.get(key) ?? 0, Number(m[3])));
  }
  const proposals: CodeProposal[] = [];
  const skipped: CodeSkip[] = [];
  const todo = ads.filter((a) => !a.code).sort((a, b) => (a.metaAdId < b.metaAdId ? -1 : a.metaAdId > b.metaAdId ? 1 : 0));
  for (const a of todo) {
    const letter = repLetter(a.campaignName, a.ownerName);
    const line = lineOf(a.adSetLine, a.adSetName);
    if (!letter) { skipped.push({ adId: a.id, reason: "noRep" }); continue; }
    if (!line) { skipped.push({ adId: a.id, reason: "noLine" }); continue; }
    const key = `${letter}-${line}`;
    let n = (next.get(key) ?? 0) + 1;
    while (used.has(`${key}-${String(n).padStart(2, "0")}`)) n++;
    if (n > 99) { skipped.push({ adId: a.id, reason: "full" }); continue; }
    next.set(key, n);
    const code = `${key}-${String(n).padStart(2, "0")}`;
    used.add(code);
    proposals.push({ adId: a.id, code, line, message: prefillMessage(line, code) });
  }
  return { proposals, skipped };
}

export async function adsForCodes(): Promise<AdForCode[]> {
  return sql<AdForCode[]>`
    SELECT a.id, a.meta_ad_id AS "metaAdId", a.name, c.name AS "campaignName", s.name AS "adSetName",
           s.product_line::text AS "adSetLine", u.full_name AS "ownerName", a.prefill_code AS code,
           COALESCE((SELECT sum(i.spend) FROM ad_insights_daily i WHERE i.ad_id = a.id AND i.date >= jakarta_today() - 30), 0)::text AS spend30
      FROM ads a JOIN ad_sets s ON s.id = a.ad_set_id JOIN ad_campaigns c ON c.id = s.campaign_id
      LEFT JOIN users u ON u.id = c.owner_user_id
      WHERE a.status IS NULL OR upper(a.status) = 'ACTIVE' OR a.prefill_code IS NOT NULL
     ORDER BY a.meta_ad_id`;
}

/** Writes the proposals; an ad that got a code meanwhile is left alone. Returns how many were written. */
export async function applyCodes(proposals: CodeProposal[]): Promise<number> {
  let n = 0;
  try {
    await sql.begin(async (tx) => {
      for (const p of proposals) {
        const done = await tx`UPDATE ads SET prefill_code = ${p.code} WHERE id = ${p.adId} AND prefill_code IS NULL RETURNING id`;
        n += done.length;
      }
    });
  } catch (err) {
    if (pgError(err)?.code === "23505") throw new Error("a code was taken meanwhile; nothing was saved, run the command again");
    throw err;
  }
  return n;
}

// a cell that starts like a formula would run when the file is opened in a spreadsheet
const csvCell = (v: string) => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV for Nabil: which ad, which code, which message. Opens in Excel and Google Sheets. */
export function toCsv(ads: AdForCode[], proposals: CodeProposal[]): string {
  const byId = new Map(ads.map((a) => [a.id, a]));
  const rows = [["Kampanye", "Set iklan", "Nama iklan", "ID iklan di Meta", "Kode", "Pesan awal WhatsApp"]];
  for (const p of proposals) {
    const a = byId.get(p.adId)!;
    rows.push([a.campaignName, a.adSetName, a.name, a.metaAdId, p.code, p.message]);
  }
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
