import { t } from "@/lib/copy";
import { INDUSTRIES } from "@/lib/contactTypes";

export type Industry = (typeof INDUSTRIES)[number];

/**
 * companies.industry is free text: 001 listed values such as "retail", "f&b",
 * "healthcare" and "hospitality" before the copy keys existed, and imports may
 * bring anything. These are the old words we know, mapped to today's keys.
 */
const ALIASES: Record<string, Industry> = {
  retail: "retail_fnb",
  "f&b": "retail_fnb",
  fnb: "retail_fnb",
  "f_b": "retail_fnb",
  "retail & f&b": "retail_fnb",
  restaurant: "retail_fnb",
  healthcare: "hospital",
  health: "hospital",
  clinic: "hospital",
  hospitality: "hotel",
  government: "government",
  bumd: "government",
  bumn: "government",
  school: "education",
  university: "education",
  advertising: "media",
  si: "partner",
  reseller: "partner",
};

const KNOWN = new Set<string>(INDUSTRIES);

/** The copy key for a stored value, or null when we don't know the word. */
export function industryKey(raw: string | null | undefined): Industry | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (KNOWN.has(v)) return v as Industry;
  return ALIASES[v] ?? null;
}

/** Old stored words that mean this key, so a search for "Retail" also finds "f&b". */
export function industryAliases(keys: readonly Industry[]): string[] {
  return Object.entries(ALIASES).filter(([, k]) => keys.includes(k)).map(([a]) => a);
}

/**
 * The label shown for a stored industry. Known keys and aliases use the copy;
 * an unknown word is shown as typed (first letter upper case) instead of a raw
 * key or a crash; nothing stored shows a dash.
 */
export function industryLabel(raw: string | null | undefined): string {
  const key = industryKey(raw);
  if (key) return t(`industry.${key}`);
  const v = (raw ?? "").trim();
  if (!v) return "—";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/** The value the company form starts with: a known key, "other" for unknown words, "" when empty. */
export function industryFormValue(raw: string | null | undefined): Industry | "" {
  if (!(raw ?? "").trim()) return "";
  return industryKey(raw) ?? "other";
}
