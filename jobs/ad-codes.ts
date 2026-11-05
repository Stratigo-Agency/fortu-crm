import { adsForCodes, applyCodes, proposeCodes, toCsv } from "@/lib/adCodes";
import { sql } from "@/lib/db";
import { writeFileSync } from "node:fs";

// Proposes codes for the ads that have none and writes the CSV for Nabil. Nothing is saved until --apply.
//   npm run ads:codes                      writes ad-codes.csv and prints what it would do
//   npm run ads:codes -- --apply           saves the same codes on the ads
//   npm run ads:codes -- --out other.csv

async function main() {
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "ad-codes.csv";
  if (!out || out.startsWith("--")) throw new Error("--out needs a file name");
  const ads = await adsForCodes();
  const { proposals, skipped } = proposeCodes(ads);
  // a run with nothing new must not replace the file Nabil already has
  if (proposals.length > 0) writeFileSync(out, toCsv(ads, proposals));
  const byId = new Map(ads.map((a) => [a.id, a]));
  for (const p of proposals) console.log(`${p.code}  ${byId.get(p.adId)!.name}`);
  for (const s of skipped) console.log(`SKIP (${s.reason})  ${byId.get(s.adId)!.name}`);
  console.log(`ad-codes: ${proposals.length} proposed, ${skipped.length} skipped ${proposals.length > 0 ? ` -> ${out}` : " (CSV not rewritten)"}`);
  if (process.argv.includes("--apply")) console.log(`ad-codes: saved ${await applyCodes(proposals)} codes`);
  else console.log("ad-codes: not saved (add --apply after checking the CSV)");
}

main()
  .then(() => sql.end().then(() => process.exit(0)))
  .catch(async (err) => {
    console.error(`ad-codes failed: ${err instanceof Error ? err.message : "unknown error"}`);
    await sql.end({ timeout: 2 }).catch(() => {});
    process.exit(1);
  });
