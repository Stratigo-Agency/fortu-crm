// Shared by the list pages: LIKE patterns that treat what the user typed as plain text.

/** "%50%%" style pattern with % _ \ escaped, so a search for "50%" matches the text, not everything. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** What to look for in phone_e164 (+62…) for a typed number: as typed, and the local 0812… form as +62812…. */
export function phonePatterns(q: string): string[] {
  const raw = q.replace(/\D/g, "");
  if (raw.length < 3) return [];
  const set = new Set([raw]);
  if (raw.startsWith("0")) set.add(`62${raw.slice(1)}`);
  else if (raw.startsWith("8")) set.add(`62${raw}`);
  return [...set].map((d) => `%${d}%`);
}
