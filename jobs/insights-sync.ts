import { sql } from "@/lib/db";
import { syncInsights } from "@/lib/meta/syncInsights";

// Nightly Meta ad insights (Railway service cron-insights: `node jobs/insights-sync.js`, cron 0 19 * * * = 02:00 Jakarta).
//   node jobs/insights-sync.js                              last 3 days up to yesterday
//   node jobs/insights-sync.js --from 2026-10-24 --to 2026-10-30   a backfill
// Exits 1 on any failure, so Railway shows the run as failed.

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (i >= 0 && (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v))) throw new Error(`--${name} needs a date like 2026-10-24`);
  return v;
}

async function main() {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !accountId) throw new Error("META_SYSTEM_USER_TOKEN and META_AD_ACCOUNT_ID must be set");
  const s = await syncInsights({ token, accountId, from: arg("from"), to: arg("to"), version: process.env.META_GRAPH_VERSION || undefined });
  console.log(`insights-sync ok from=${s.from} to=${s.to} rows=${s.rows} ads=${s.ads} spend=Rp${s.spend} conversations=${s.conversations}`);
}

main()
  .then(() => sql.end().then(() => process.exit(0)))
  .catch(async (err) => {
    console.error(`insights-sync failed: ${err instanceof Error ? err.message : "unknown error"}`);
    await sql.end({ timeout: 2 }).catch(() => {});
    process.exit(1);
  });
