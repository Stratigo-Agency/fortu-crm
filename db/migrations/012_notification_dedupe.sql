-- 012 · Notifications: two more kinds, one row per day, and the payload of a deal alert (6 Nov 2026)

-- INTEGRATIONS.md lists next-step and discount alerts next to the four kinds of 001.
ALTER TYPE notif_kind ADD VALUE IF NOT EXISTS 'next_step_overdue';
ALTER TYPE notif_kind ADD VALUE IF NOT EXISTS 'discount_approval';

-- The Jakarta day a notification was sent: the "day" of the dedupe rule.
ALTER TABLE notifications ADD COLUMN day date GENERATED ALWAYS AS ((sent_at AT TIME ZONE 'Asia/Jakarta')::date) STORED;

-- The sweeper may run every hour: one row per (kind, deal, person, channel, day), whatever the run count.
CREATE UNIQUE INDEX notifications_dedupe ON notifications (kind, deal_id, user_id, channel, day) WHERE deal_id IS NOT NULL;
-- The bell: a person's latest in-app notifications, unread first by count.
CREATE INDEX notifications_bell ON notifications (user_id, sent_at DESC) WHERE channel = 'in_app';

-- The shared part of every alert payload (INTEGRATIONS.md · Alerts). The job adds kind, occurred_at and the url.
CREATE VIEW v_deal_alert_payload AS
SELECT d.id AS deal_id,
       jsonb_build_object(
         'deal', jsonb_build_object(
           'id', d.id, 'name', d.name, 'amount', d.amount, 'stage', d.stage_name, 'probability', d.probability,
           'weighted_amount', d.weighted_amount, 'expected_close_date', d.expected_close_date,
           'product_lines', COALESCE((SELECT jsonb_agg(DISTINCT p.product_line::text)
                                        FROM deal_line_items li JOIN products p ON p.id = li.product_id
                                       WHERE li.deal_id = d.id AND p.product_line IS NOT NULL), '[]'::jsonb)),
         'owner', jsonb_build_object('id', u.id, 'name', u.full_name),
         'contact', jsonb_build_object('name', c.full_name, 'company', co.name, 'industry', co.industry),
         'source', jsonb_build_object('channel', l.source_channel, 'ad', a.name, 'capture_method', l.capture_method)
       ) AS body
  FROM v_deals_enriched d
  LEFT JOIN users u      ON u.id = d.owner_user_id
  LEFT JOIN contacts c   ON c.id = d.contact_id
  LEFT JOIN companies co ON co.id = d.company_id
  LEFT JOIN leads l      ON l.id = d.lead_id
  LEFT JOIN ads a        ON a.id = l.ad_id;
