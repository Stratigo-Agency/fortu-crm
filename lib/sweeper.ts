import { sql } from "@/lib/db";

// The hourly sweeper: reminds sales reps about their OWN deals and writes one notification per person,
// kind, deal and Jakarta day (unique index notifications_dedupe, migration 012), so running it every hour
// is safe. Rules follow INTEGRATIONS.md · Alerts. Only the owner is ever told: no alerts about other
// people's deals (big deals, won deals, discounts) go to the CEO or the sales leads.

export type SweepCounts = { stale_deal: number; next_step_overdue: number };

/** The public address for links. In production it must be set, or reminders would point at localhost. */
function baseUrl(): string {
  const url = process.env.AUTH_URL;
  if (!url && process.env.NODE_ENV === "production") throw new Error("AUTH_URL is not set (links in reminders need the public address)");
  return (url || "http://localhost:3000").replace(/\/$/, "");
}

/** The full payload: the shared part of the view, plus kind, time and a link to the deal. */
const payloadOf = (kind: string, dealId: string) => sql`
  jsonb_set(
    p.body || jsonb_build_object('kind', ${kind}::text,
      'occurred_at', to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00'),
    '{deal,url}', to_jsonb(${baseUrl()}::text || '/deal/' || ${sql(dealId)}::text))`;

const OPEN = sql`NOT d.is_won AND NOT d.is_lost`;
const BIG = sql`d.amount >= setting_num('high_value_amount')`;

/**
 * A big deal that has not moved past its stage's stale days: its owner hears once per episode. A new episode
 * starts when someone updates the deal. Nobody else is told (Pak Jovian asked for no alerts about other
 * people's deals; Laporan shows what needs attention instead).
 */
async function staleDeals(): Promise<number> {
  const rows = await sql`
    INSERT INTO notifications (user_id, kind, deal_id, channel, payload)
    SELECT d.owner_user_id, 'stale_deal'::notif_kind, d.id, 'in_app', ${payloadOf("stale_deal", "d.id")}
      FROM v_deals_enriched d
      JOIN v_deal_alert_payload p ON p.deal_id = d.id
      JOIN users o ON o.id = d.owner_user_id AND o.is_active
     WHERE ${OPEN} AND ${BIG} AND d.is_stale
       AND NOT EXISTS (SELECT 1 FROM notifications n
                        WHERE n.kind = 'stale_deal' AND n.deal_id = d.id AND n.user_id = d.owner_user_id
                          AND n.channel = 'in_app' AND n.sent_at >= d.updated_at)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return rows.length;
}

/** The next step is past its date: the owner, once a day until it is done. A deal without an active owner tells nobody. */
async function overdueNextSteps(): Promise<number> {
  const rows = await sql`
    INSERT INTO notifications (user_id, kind, deal_id, channel, payload)
    SELECT d.owner_user_id, 'next_step_overdue'::notif_kind, d.id, 'in_app',
           jsonb_set(${payloadOf("next_step_overdue", "d.id")}, '{deal,next_step}', to_jsonb(d.next_step))
      FROM v_deals_enriched d
      JOIN v_deal_alert_payload p ON p.deal_id = d.id
      JOIN users o ON o.id = d.owner_user_id AND o.is_active
     WHERE ${OPEN} AND d.next_step_overdue
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return rows.length;
}

/** One sweep: the number of new notifications per kind. */
export async function runSweep(): Promise<SweepCounts> {
  return {
    stale_deal: await staleDeals(),
    next_step_overdue: await overdueNextSteps(),
  };
}
