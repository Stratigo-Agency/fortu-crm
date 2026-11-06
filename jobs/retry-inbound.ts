import { sql } from "@/lib/db";
import { retryInbound } from "@/lib/whatsapp/retry";

// WhatsApp webhook retries (Railway service cron-retry-inbound: `node jobs/retry-inbound.js`, every 5 minutes).
// Processes inbound_events that are still unprocessed 2 minutes after they arrived (lib/whatsapp/retry.ts).
// Exits 1 when an event failed again, so Railway shows the run as failed.

const LOCK = 471619; // one run at a time per database

async function main() {
  const lock = await sql.reserve();
  try {
    const [{ locked }] = await lock<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK}) AS locked`;
    if (!locked) {
      console.log("retry-inbound skipped: another run is still going");
      return;
    }
    const c = await retryInbound();
    console.log(`retry-inbound ok found=${c.found} processed=${c.processed} failed=${c.failed}`);
    if (c.failed > 0) throw new Error(`${c.failed} event(s) failed again`);
  } finally {
    await lock`SELECT pg_advisory_unlock(${LOCK})`.catch(() => {});
    lock.release();
  }
}

main()
  .then(() => sql.end().then(() => process.exit(0)))
  .catch(async (err) => {
    console.error(`retry-inbound failed: ${err instanceof Error ? err.message : "unknown error"}`);
    await sql.end({ timeout: 2 }).catch(() => {});
    process.exit(1);
  });
