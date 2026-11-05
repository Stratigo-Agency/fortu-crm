import { sql } from "@/lib/db";
import { runSweep } from "@/lib/sweeper";

// Hourly sweeper (Railway service cron-sweeper: `node jobs/sweeper.js`, cron 0 1-13 * * * = 08:00-20:00 Jakarta).
// Writes the alerts of lib/sweeper.ts. Exits 1 on any failure, so Railway shows the run as failed.

async function main() {
  const counts = await runSweep();
  console.log(`sweeper ok ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}

main()
  .then(() => sql.end().then(() => process.exit(0)))
  .catch(async (err) => {
    console.error(`sweeper failed: ${err instanceof Error ? err.message : "unknown error"}`);
    await sql.end({ timeout: 2 }).catch(() => {});
    process.exit(1);
  });
