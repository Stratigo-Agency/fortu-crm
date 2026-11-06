import { configFromEnv, createAccurateClient } from "@/lib/accurate/client";
import { sql } from "@/lib/db";
import { applyPlan, buildPlan, fetchAccurate, jakartaToday, summarize, type Plan } from "@/lib/accurate/sync";

// Nightly Accurate read (Railway service cron-accurate: `node jobs/accurate-sync.js`, cron 0 18 * * * = 01:00 Jakarta).
//   node jobs/accurate-sync.js --dry-run     print what would change, write nothing
//   node jobs/accurate-sync.js --months 6    sales window (default 3 months incl. this one)
// Only GET calls go to Accurate. Exits 1 on any failure, so Railway shows the run as failed.

const flag = (n: string) => process.argv.includes(`--${n}`);
function numArg(n: string): number | undefined {
  const i = process.argv.indexOf(`--${n}`);
  if (i < 0) return undefined;
  const v = Number(process.argv[i + 1]);
  if (!Number.isInteger(v) || v < 1) throw new Error(`--${n} needs a whole number`);
  return v;
}

function report(plan: Plan, dry: boolean) {
  const head = dry ? "DRY RUN, nothing written" : "applied";
  console.log(`accurate-sync ${head}`);
  for (const c of plan.products) console.log(`  product ${c.sku}: ${JSON.stringify(c.set)}`);
  for (const s of plan.stock.slice(0, 200)) console.log(`  stock ${s.sku} @ ${s.warehouse}: ${s.qty}`);
  for (const l of [...plan.po.insert.map((x) => ["new", x] as const), ...plan.po.update.map((x) => ["update", x] as const)]) console.log(`  PO ${l[0]} ${l[1].sku} qty=${l[1].qty} eta=${l[1].eta ?? "-"}`);
  for (const k of plan.po.close) console.log(`  PO close ${k}`);
  for (const s of plan.sales) console.log(`  sales ${s.sku} ${s.month.slice(0, 7)}: qty=${s.qty} Rp${s.revenue}`);
  console.log(`unmatched, in Accurate but not in the CRM (${plan.onlyInAccurate.length}): ${plan.onlyInAccurate.map((x) => x.sku).join(", ") || "-"}`);
  console.log(`unmatched, in the CRM but not in Accurate (${plan.onlyInCrm.length}): ${plan.onlyInCrm.map((x) => x.sku).join(", ") || "-"}`);
  for (const c of plan.conflicts) console.log(`  conflict ${c}`);
  for (const u of plan.unknownTypes) console.log(`  unknown item type ${u.sku}: ${u.type} (left alone)`);
  for (const w of plan.warnings) console.warn(`  WARNING ${w}`);
}

async function main() {
  const dry = flag("dry-run");
  const today = jakartaToday();
  const client = createAccurateClient(configFromEnv());
  const data = await fetchAccurate(client, { today, months: numArg("months"), throttleMs: 100 });
  const plan = await buildPlan(data);
  if (!dry) await applyPlan(plan, today);
  report(plan, dry);
  console.log(`accurate-sync ok ${dry ? "dry-run " : ""}${JSON.stringify(summarize(plan))}`);
  // the safe parts were applied; a part that was held back makes the run show as failed in Railway
  if (plan.warnings.length) throw new Error(`${plan.warnings.length} part(s) held back, see WARNING lines above`);
}

main()
  .then(() => sql.end().then(() => process.exit(0)))
  .catch(async (err) => {
    console.error(`accurate-sync failed: ${err instanceof Error ? err.message : "unknown error"}`);
    await sql.end({ timeout: 2 }).catch(() => {});
    process.exit(1);
  });
