const HONORIFICS = new Set(["pak", "bu", "ibu", "bapak"]);

/** Avatar initials: "Siska" → SI, "Rudi H" → RH, "Pak Jovian" → JO. Pure, for server and client. */
export function initials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const named = words.length > 1 && HONORIFICS.has(words[0].toLowerCase()) ? words.slice(1) : words;
  if (named.length === 0) return "";
  const letters = named.length > 1 ? named[0][0] + named[1][0] : named[0].slice(0, 2);
  return letters.toUpperCase();
}
