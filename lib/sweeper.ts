import { sql } from "@/lib/db";

// The hourly sweeper: finds deals that need someone's attention and writes one notification per person,
// kind, deal and Jakarta day (unique index notifications_dedupe, migration 012), so running it every hour
// is safe. Rules follow INTEGRATIONS.md · Alerts.

export type SweepCounts = {
  high_value_lead: number; stale_deal: number; won: number; next_step_overdue: number; discount_approval: number;
};

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
 * Deal created or re-priced to the high-value line: the CEO and the sales leads hear about it once per price.
 * Only deals touched in the last two days count, so the first run after going live doesn't announce every old deal.
 */
async function highValueLeads(): Promise<number> {
  const rows = await sql`
    INSERT INTO notifications (user_id, kind, deal_id, channel, payload)
    SELECT u.id, 'high_value_lead'::notif_kind, d.id, 'in_app', ${payloadOf("high_value_lead", "d.id")}
      FROM v_deals_enriched d
      JOIN v_deal_alert_payload p ON p.deal_id = d.id
      JOIN users u ON u.is_active AND u.role IN ('ceo', 'sales_lead')
     WHERE ${OPEN} AND ${BIG} AND d.updated_at > now() - interval '2 days'
       AND NOT EXISTS (SELECT 1 FROM notifications n
                        WHERE n.kind = 'high_value_lead' AND n.deal_id = d.id AND n.channel = 'in_app'
                          AND (n.payload #>> '{deal,amount}')::numeric = d.amount)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return rows.length;
}

/**
 * A big deal that has not moved past its stage's stale days: the owner hears on the first day, and the CEO
 * from the second day on (once). A new episode starts when someone updates the deal.
 */
async function staleDeals(): Promise<number> {
  const owner = await sql`
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
  const ceo = await sql`
    INSERT INTO notifications (user_id, kind, deal_id, channel, payload)
    SELECT u.id, 'stale_deal'::notif_kind, d.id, 'in_app', ${payloadOf("stale_deal", "d.id")}
      FROM v_deals_enriched d
      JOIN v_deal_alert_payload p ON p.deal_id = d.id
      JOIN users u ON u.is_active AND u.role = 'ceo'
     WHERE ${OPEN} AND ${BIG} AND d.is_stale
       AND EXISTS (SELECT 1 FROM notifications n
                    WHERE n.kind = 'stale_deal' AND n.deal_id = d.id AND n.user_id = d.owner_user_id
                      AND n.channel = 'in_app' AND n.sent_at >= d.updated_at AND n.day < jakarta_today())
       AND NOT EXISTS (SELECT 1 FROM notifications n
                        WHERE n.kind = 'stale_deal' AND n.deal_id = d.id AND n.user_id = u.id
                          AND n.channel = 'in_app' AND n.sent_at >= d.updated_at)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  // an owner who is gone or inactive can't act: the CEO hears right away (once per episode)
  const orphan = await sql`
    INSERT INTO notifications (user_id, kind, deal_id, channel, payload)
    SELECT u.id, 'stale_deal'::notif_kind, d.id, 'in_app', ${payloadOf("stale_deal", "d.id")}
      FROM v_deals_enriched d
      JOIN v_deal_alert_payload p ON p.deal_id = d.id
      JOIN users u ON u.is_active AND u.role = 'ceo'
     WHERE ${OPEN} AND ${BIG} AND d.is_stale
       AND NOT EXISTS (SELECT 1 FROM users o WHERE o.id = d.owner_user_id AND o.is_active)
       AND NOT EXISTS (SELECT 1 FROM notifications n
                        WHERE n.kind = 'stale_deal' AND n.deal_id = d.id AND n.user_id = u.id
                          AND n.channel = 'in_app' AND n.sent_at >= d.updated_at)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return owner.length + ceo.length + orphan.length;
}

/**
 * A deal that reached Done deal in the last two days: the CEO, the sales leads and the owner, once each.
 * (Not "paid today": the sweeper sleeps at night and the payment date can be in the past.)
 */
async function wonDeals(): Promise<number> {
  const rows = await sql`
    INSERT INTO notifications (user_id, kind, deal_id, channel, payload)
    SELECT u.id, 'won'::notif_kind, d.id, 'in_app', ${payloadOf("won", "d.id")}
      FROM v_deals_enriched d
      JOIN v_deal_alert_payload p ON p.deal_id = d.id
      JOIN users u ON u.is_active AND (u.role IN ('ceo', 'sales_lead') OR u.id = d.owner_user_id)
     WHERE d.is_won AND d.stage_entered_at > now() - interval '2 days'
       AND NOT EXISTS (SELECT 1 FROM notifications n
                        WHERE n.kind = 'won' AND n.deal_id = d.id AND n.user_id = u.id AND n.channel = 'in_app')
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return rows.length;
}

/** The next step is past its date: the owner, once a day until it is done (the sales leads and CEO when nobody active owns it). */
async function overdueNextSteps(): Promise<number> {
  const rows = await sql`
    INSERT INTO notifications (user_id, kind, deal_id, channel, payload)
    SELECT u.id, 'next_step_overdue'::notif_kind, d.id, 'in_app',
           jsonb_set(${payloadOf("next_step_overdue", "d.id")}, '{deal,next_step}', to_jsonb(d.next_step))
      FROM v_deals_enriched d
      JOIN v_deal_alert_payload p ON p.deal_id = d.id
      JOIN users u ON u.is_active AND (
             u.id = d.owner_user_id
          OR (u.role IN ('ceo', 'sales_lead') AND NOT EXISTS (SELECT 1 FROM users o WHERE o.id = d.owner_user_id AND o.is_active)))
     WHERE ${OPEN} AND d.next_step_overdue
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return rows.length;
}

/** A discount above the limit waits for approval: the CEO hears once per price (again if the deal is re-priced). */
async function discountApprovals(): Promise<number> {
  const rows = await sql`
    INSERT INTO notifications (user_id, kind, deal_id, channel, payload)
    SELECT u.id, 'discount_approval'::notif_kind, d.id, 'in_app', ${payloadOf("discount_approval", "d.id")}
      FROM v_deals_enriched d
      JOIN v_deal_alert_payload p ON p.deal_id = d.id
      JOIN users u ON u.is_active AND u.role = 'ceo'
     WHERE ${OPEN} AND d.needs_discount_approval
       AND NOT EXISTS (SELECT 1 FROM notifications n
                        WHERE n.kind = 'discount_approval' AND n.deal_id = d.id AND n.user_id = u.id AND n.channel = 'in_app'
                          AND (n.payload #>> '{deal,amount}')::numeric = d.amount)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return rows.length;
}

/** One sweep: the number of new notifications per kind. */
export async function runSweep(): Promise<SweepCounts> {
  return {
    high_value_lead: await highValueLeads(),
    stale_deal: await staleDeals(),
    won: await wonDeals(),
    next_step_overdue: await overdueNextSteps(),
    discount_approval: await discountApprovals(),
  };
}
