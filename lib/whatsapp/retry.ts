import { sql } from "@/lib/db";
import { processWebhookEvent, WEBHOOK_PROVIDER } from "./process";

// Webhook events that were stored but not processed (the server stopped, the database blipped): processed again
// once they are older than `olderThanMinutes`. processWebhookEvent claims each one first (claimed_at), so an event
// the live request is still working on is skipped, not processed twice. The text that only the live request had in
// memory is not available here: a retried message is kept as metadata only.
// After MAX_ATTEMPTS tries an event stays for a person to look at (inbound_events.error has the reason; the stored
// payload was trimmed before it was saved, so it holds no message text or names).

export const MAX_ATTEMPTS = 5;

export async function retryInbound(o: { olderThanMinutes?: number; limit?: number } = {}) {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM inbound_events
     WHERE provider = ${WEBHOOK_PROVIDER} AND processed_at IS NULL AND attempts < ${MAX_ATTEMPTS}
       AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
       AND received_at < now() - make_interval(mins => ${o.olderThanMinutes ?? 2})
     ORDER BY received_at
     LIMIT ${o.limit ?? 200}`;
  const counts = { found: rows.length, processed: 0, failed: 0 };
  for (const { id } of rows) {
    const r = await processWebhookEvent(id);
    if (r.status === "processed") counts.processed += 1;
    else if (r.status === "failed") counts.failed += 1;
  }
  return counts;
}
