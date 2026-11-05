import { sql } from "@/lib/db";
import { mailerFromEnv, sendDigests } from "@/lib/mail";
import { runSweep } from "@/lib/sweeper";

// Hourly sweeper (Railway service cron-sweeper: `node jobs/sweeper.js`, cron 0 1-13 * * * = 08:00-20:00 Jakarta).
// Writes the alerts of lib/sweeper.ts, then emails the ones marked "email" (lib/mail.ts).
// Exits 1 on any failure, so Railway shows the run as failed.

// Two runs at once (a slow run still going when the next hour starts) would both email: one lock per database.
const LOCK = 471600;

async function main() {
  const lock = await sql.reserve();
  try {
    const [{ locked }] = await lock<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK}) AS locked`;
    if (!locked) {
      console.log("sweeper skipped: another run is still going");
      return;
    }
    await sweep();
  } finally {
    await lock`SELECT pg_advisory_unlock(${LOCK})`.catch(() => {});
    lock.release();
  }
}

async function sweep() {
  const counts = await runSweep();
  const mailer = mailerFromEnv();
  let mail = "email skipped (SMTP_* not set)";
  if (mailer) {
    const from = process.env.SMTP_FROM || (process.env.SMTP_USER as string);
    const r = await sendDigests(mailer, from);
    mail = `emails=${r.emails} items=${r.items} failed=${r.failed}`;
    if (r.failed > 0) throw new Error(`${r.failed} email(s) failed (${mail})`);
  }
  console.log(`sweeper ok ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")} ${mail}`);
}

main()
  .then(() => sql.end().then(() => process.exit(0)))
  .catch(async (err) => {
    console.error(`sweeper failed: ${err instanceof Error ? err.message : "unknown error"}`);
    await sql.end({ timeout: 2 }).catch(() => {});
    process.exit(1);
  });
