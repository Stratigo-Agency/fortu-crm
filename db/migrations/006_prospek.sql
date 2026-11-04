-- 006 · Prospek (4 Nov 2026)
-- 1) can_edit_lead: an unowned lead can be picked up by a sales rep, not by marketing (view only).
-- 2) Index for finding the lead of a retried delivery that was merged into an earlier lead.
-- 3) v_leads_enriched: one row per lead with contact, owner, ad/click code and age, for /prospek.
-- 4) v_prospek_stats: the numbers on /prospek per owner (is_total = all owners together).

CREATE OR REPLACE FUNCTION can_edit_lead(p_user uuid, p_lead uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u, leads l
    WHERE u.id = p_user AND l.id = p_lead AND u.is_active
      AND (u.role IN ('admin','ceo','sales_lead')
           OR l.owner_user_id = u.id
           OR (l.owner_user_id IS NULL AND u.role = 'sales_rep')))
$$;

CREATE INDEX activities_inbound_event_idx ON activities ((metadata->>'inbound_event_id'))
  WHERE metadata ? 'inbound_event_id';

CREATE VIEW v_leads_enriched AS
SELECT l.id,
       l.status,
       l.contact_id,
       l.owner_user_id,
       l.source_channel,
       l.capture_method,
       l.product_interest,
       l.ad_id,
       l.first_message,
       l.received_at,
       l.logged_at,
       l.first_response_at,
       l.disqualify_reason,
       l.deal_id,
       l.is_sample,
       c.full_name   AS contact_name,
       c.phone_e164,
       u.full_name   AS owner_name,
       a.prefill_code AS ad_code,
       (SELECT e.ref_code FROM wa_click_events e
         WHERE e.matched_lead_id = l.id ORDER BY e.clicked_at DESC LIMIT 1) AS click_code,
       (l.received_at AT TIME ZONE 'Asia/Jakarta')::date AS received_day,
       round(extract(epoch FROM (l.logged_at - l.received_at)) / 60)::int AS log_delay_min,
       (l.status = 'new' AND l.received_at < now() - interval '2 hours') AS is_late
  FROM leads l
  JOIN contacts c ON c.id = l.contact_id
  LEFT JOIN users u ON u.id = l.owner_user_id
  LEFT JOIN ads a ON a.id = l.ad_id;

CREATE VIEW v_prospek_stats AS
SELECT owner_user_id,
       (GROUPING(owner_user_id) = 1) AS is_total,
       count(*) FILTER (WHERE status = 'new')::int       AS new_count,
       count(*) FILTER (WHERE status = 'contacted')::int AS contacted_count,
       count(*) FILTER (WHERE status IN ('new', 'contacted', 'qualified'))::int AS open_count,
       count(*) FILTER (WHERE received_day = (now() AT TIME ZONE 'Asia/Jakarta')::date)::int AS received_today,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (logged_at - received_at)) / 60)
              FILTER (WHERE received_at > now() - interval '7 days'))::numeric)::int AS median_log_delay_min,
       count(*) FILTER (WHERE source_channel = 'meta_ctwa' AND ad_id IS NULL
                          AND received_at > now() - interval '7 days')::int AS meta_without_code
  FROM v_leads_enriched
 GROUP BY GROUPING SETS ((owner_user_id), ());
