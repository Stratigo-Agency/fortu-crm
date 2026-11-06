-- 016 · Lead funnel by source (6 Nov 2026, Pak Jovian's feedback)
-- How many leads came in, where each one came from, and at which step of the sales flow they stop.
-- 1) source_groups + source_channel_groups + source_group(): the five groups the report shows.
-- 2) lead_funnel_cohort(): the leads received in a period (Jakarta dates) and how far each one got.
-- 3) lead_funnel_steps(): per source group (and the total) and step: how many entered, passed,
--    the conversion, the median days spent before the step, and the weakest step (the bottleneck).
-- 4) lead_funnel(): the same as one row per group, for the table on /laporan and the figure on Beranda.
-- 5) v_leads_enriched: the source group, ad name, UTM and landing page of each lead (traceability);
--    v_prospek_stats leaves sample rows out.
-- Sample rows (is_sample) never count. Numbered 016 because open PRs use 013–015.

-- ───────── 1. Source groups ─────────
CREATE TABLE source_groups (
  key       text PRIMARY KEY,
  position  smallint NOT NULL UNIQUE
);
INSERT INTO source_groups (key, position) VALUES
  ('meta', 1), ('website', 2), ('offline', 3), ('wa_direct', 4), ('other', 5);

-- A channel that is not listed here (e.g. a new enum value) falls into 'other'.
CREATE TABLE source_channel_groups (
  source_channel  source_channel PRIMARY KEY,
  group_key       text NOT NULL REFERENCES source_groups(key)
);
INSERT INTO source_channel_groups (source_channel, group_key) VALUES
  ('meta_ctwa', 'meta'), ('meta_leadform', 'meta'), ('instagram_dm', 'meta'),
  ('website_form', 'website'), ('website_wa_link', 'website'), ('google_ads', 'website'),
  ('walk_in', 'offline'), ('event', 'offline'), ('referral', 'offline'),
  ('partner_si', 'offline'), ('tender', 'offline'), ('repeat_order', 'offline'),
  ('whatsapp_direct', 'wa_direct'),
  ('other', 'other');

CREATE FUNCTION source_group(p_channel source_channel) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT group_key FROM source_channel_groups WHERE source_channel = p_channel), 'other')
$$;

-- A step needs at least this many leads entering it before it can be called the bottleneck.
INSERT INTO app_settings (key, value) VALUES ('funnel_min_entering', '5') ON CONFLICT (key) DO NOTHING;

-- ───────── 2. The cohort: leads received in [p_from, p_to] ─────────
-- A lead belongs to its owner; an unowned lead to the owner of its first deal.
-- handled  = first response recorded, status past 'new', or already a deal.
-- reached  = the furthest stage position any of its deals ever reached (stage history + current stage).
--            Skipping a stage counts as passing it: a deal created at PO has passed Quotation.
--            Done counts only while the deal is Done now. 0 = no deal.
-- is_lost  = every deal of the lead ended Lost (and none is Done).
CREATE FUNCTION lead_funnel_cohort(p_from date, p_to date, p_owner uuid DEFAULT NULL)
RETURNS TABLE (lead_id uuid, group_key text, owner_user_id uuid, received_at timestamptz,
               handled boolean, has_deal boolean, first_deal_at timestamptz,
               reached smallint, is_won boolean, is_lost boolean)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT l.id, source_group(l.source_channel) AS group_key, l.status, l.first_response_at, l.received_at, l.deal_id,
           COALESCE(l.owner_user_id,
                    (SELECT d.owner_user_id FROM deals d
                      WHERE (d.lead_id = l.id OR d.id = l.deal_id) AND NOT d.is_sample
                      ORDER BY d.created_at LIMIT 1)) AS owner_user_id
      FROM leads l
     WHERE NOT l.is_sample
       AND (l.received_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_from AND p_to),
  open_min AS (SELECT min(position) AS pos FROM pipeline_stages WHERE NOT is_won AND NOT is_lost),
  deal_reach AS (
    SELECT b.id AS lead_id, d.created_at, s.is_won, s.is_lost,
           COALESCE(GREATEST(CASE WHEN NOT s.is_lost THEN s.position END,
                             (SELECT max(hs.position) FROM deal_stage_history h
                                JOIN pipeline_stages hs ON hs.id = h.to_stage_id
                               WHERE h.deal_id = d.id AND NOT hs.is_won AND NOT hs.is_lost)),
                    (SELECT pos FROM open_min)) AS reached
      FROM base b
      JOIN deals d ON (d.lead_id = b.id OR d.id = b.deal_id) AND NOT d.is_sample
      JOIN pipeline_stages s ON s.id = d.stage_id),
  per_lead AS (
    SELECT r.lead_id, max(r.reached) AS reached, min(r.created_at) AS first_deal_at,
           bool_or(r.is_won) AS is_won, bool_and(r.is_lost) AS all_lost
      FROM deal_reach r GROUP BY r.lead_id)
  SELECT b.id, b.group_key, b.owner_user_id, b.received_at,
         (b.status <> 'new' OR b.first_response_at IS NOT NULL OR p.lead_id IS NOT NULL),
         p.lead_id IS NOT NULL,
         p.first_deal_at,
         COALESCE(p.reached, 0)::smallint,
         COALESCE(p.is_won, false),
         COALESCE(p.all_lost AND NOT p.is_won, false)
    FROM base b LEFT JOIN per_lead p ON p.lead_id = b.id
   WHERE p_owner IS NULL OR b.owner_user_id = p_owner
$$;

-- ───────── 3. Steps, conversion, median days, bottleneck ─────────
-- Steps (named after where they lead): handled, deal, quotation, negotiation, po, done.
-- entered = leads that reached the step before; passed = leads that reached this one.
-- median_days = median days spent before the step: lead received → first deal for 'deal',
--   days in Chat masuk / Quotation / Negotiation / PO for the four stage steps (stays that ended).
-- is_bottleneck = the step with the lowest conversion among steps with enough leads entering
--   (app_settings.funnel_min_entering), and only when some leads stopped there.
CREATE FUNCTION lead_funnel_steps(p_from date, p_to date, p_owner uuid DEFAULT NULL)
RETURNS TABLE (group_key text, group_position smallint, is_total boolean, step_key text, step_position smallint,
               entered int, passed int, conversion_pct int, median_days numeric, enough_data boolean, is_bottleneck boolean)
LANGUAGE sql STABLE AS $$
  WITH c AS (SELECT * FROM lead_funnel_cohort(p_from, p_to, p_owner)),
  pos AS (
    SELECT max(position) FILTER (WHERE key = 'chat')        AS chat,
           max(position) FILTER (WHERE key = 'quotation')   AS quotation,
           max(position) FILTER (WHERE key = 'negotiation') AS negotiation,
           max(position) FILTER (WHERE key = 'po')          AS po
      FROM pipeline_stages),
  steps(step_key, step_position, from_stage) AS (
    VALUES ('handled', 1::smallint, NULL), ('deal', 2::smallint, NULL), ('quotation', 3::smallint, 'chat'),
           ('negotiation', 4::smallint, 'quotation'), ('po', 5::smallint, 'negotiation'), ('done', 6::smallint, 'po')),
  groups AS (
    SELECT key AS group_key, position AS group_position, false AS is_total FROM source_groups
    UNION ALL SELECT 'total', 0::smallint, true),
  lead_steps AS (
    SELECT c.lead_id, c.group_key, s.step_key,
           CASE s.step_key
             WHEN 'handled'     THEN true
             WHEN 'deal'        THEN c.handled
             WHEN 'quotation'   THEN c.has_deal
             WHEN 'negotiation' THEN c.reached >= pos.quotation
             WHEN 'po'          THEN c.reached >= pos.negotiation
             WHEN 'done'        THEN c.reached >= pos.po END AS entered,
           CASE s.step_key
             WHEN 'handled'     THEN c.handled
             WHEN 'deal'        THEN c.has_deal
             WHEN 'quotation'   THEN c.reached >= pos.quotation
             WHEN 'negotiation' THEN c.reached >= pos.negotiation
             WHEN 'po'          THEN c.reached >= pos.po
             WHEN 'done'        THEN c.is_won END AS passed
      FROM c CROSS JOIN pos CROSS JOIN steps s),
  -- How long the cohort's deals stayed in each stage (only stays that ended with a move).
  stays AS (
    SELECT x.group_key, x.stage_key, x.days FROM (
      SELECT c.group_key, hs.key AS stage_key,
             extract(epoch FROM (lead(h.changed_at) OVER (PARTITION BY h.deal_id ORDER BY h.changed_at, h.id) - h.changed_at)) / 86400 AS days
        FROM c
        JOIN leads l ON l.id = c.lead_id
        JOIN deals d ON (d.lead_id = l.id OR d.id = l.deal_id) AND NOT d.is_sample
        JOIN deal_stage_history h ON h.deal_id = d.id
        JOIN pipeline_stages hs ON hs.id = h.to_stage_id) x
     WHERE x.days IS NOT NULL
    UNION ALL
    SELECT c.group_key, '_lead', extract(epoch FROM (c.first_deal_at - c.received_at)) / 86400
      FROM c WHERE c.has_deal),
  agg AS (
    SELECT g.group_key, g.group_position, g.is_total, s.step_key, s.step_position,
           count(ls.lead_id) FILTER (WHERE ls.entered)::int AS entered,
           count(ls.lead_id) FILTER (WHERE ls.passed)::int  AS passed,
           (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY st.days)::numeric, 1)
              FROM stays st
             WHERE st.stage_key = COALESCE(s.from_stage, CASE WHEN s.step_key = 'deal' THEN '_lead' END)
               AND (g.is_total OR st.group_key = g.group_key)) AS median_days
      FROM groups g
      CROSS JOIN steps s
      LEFT JOIN lead_steps ls ON ls.step_key = s.step_key AND (g.is_total OR ls.group_key = g.group_key)
     GROUP BY g.group_key, g.group_position, g.is_total, s.step_key, s.step_position, s.from_stage),
  scored AS (
    SELECT a.*,
           a.entered >= COALESCE(setting_num('funnel_min_entering'), 5) AS enough,
           row_number() OVER (PARTITION BY a.group_key
                              ORDER BY (a.entered >= COALESCE(setting_num('funnel_min_entering'), 5) AND a.passed < a.entered) DESC,
                                       a.passed::numeric / NULLIF(a.entered, 0) ASC NULLS LAST,
                                       a.step_position) AS weakest
      FROM agg a)
  SELECT s.group_key, s.group_position, s.is_total, s.step_key, s.step_position, s.entered, s.passed,
         round(s.passed * 100.0 / NULLIF(s.entered, 0))::int,
         s.median_days,
         s.enough,
         (s.weakest = 1 AND s.enough AND s.passed < s.entered)
    FROM scored s
   ORDER BY s.group_position, s.step_position
$$;

-- ───────── 4. One row per group ─────────
-- bottleneck_status: 'found' (a step is the bottleneck), 'insufficient' (no step has enough leads
-- entering yet), 'none' (enough leads, and none stopped anywhere).
CREATE FUNCTION lead_funnel(p_from date, p_to date, p_owner uuid DEFAULT NULL)
RETURNS TABLE (group_key text, group_position smallint, is_total boolean,
               leads int, handled int, deals int, quotation int, negotiation int, po int, done int, lost int, unhandled int,
               pct_handled int, pct_deal int, pct_quotation int, pct_negotiation int, pct_po int, pct_done int,
               pct_lead_to_done int, bottleneck_step text, bottleneck_pct int, bottleneck_status text)
LANGUAGE sql STABLE AS $$
  WITH s AS (SELECT * FROM lead_funnel_steps(p_from, p_to, p_owner)),
  c AS (SELECT * FROM lead_funnel_cohort(p_from, p_to, p_owner)),
  w AS (
    SELECT s.group_key, s.group_position, s.is_total,
           max(s.entered) FILTER (WHERE s.step_key = 'handled')     AS leads,
           max(s.passed)  FILTER (WHERE s.step_key = 'handled')     AS handled,
           max(s.passed)  FILTER (WHERE s.step_key = 'deal')        AS deals,
           max(s.passed)  FILTER (WHERE s.step_key = 'quotation')   AS quotation,
           max(s.passed)  FILTER (WHERE s.step_key = 'negotiation') AS negotiation,
           max(s.passed)  FILTER (WHERE s.step_key = 'po')          AS po,
           max(s.passed)  FILTER (WHERE s.step_key = 'done')        AS done,
           max(s.conversion_pct) FILTER (WHERE s.step_key = 'handled')     AS pct_handled,
           max(s.conversion_pct) FILTER (WHERE s.step_key = 'deal')        AS pct_deal,
           max(s.conversion_pct) FILTER (WHERE s.step_key = 'quotation')   AS pct_quotation,
           max(s.conversion_pct) FILTER (WHERE s.step_key = 'negotiation') AS pct_negotiation,
           max(s.conversion_pct) FILTER (WHERE s.step_key = 'po')          AS pct_po,
           max(s.conversion_pct) FILTER (WHERE s.step_key = 'done')        AS pct_done,
           max(s.step_key) FILTER (WHERE s.is_bottleneck)           AS bottleneck_step,
           max(s.conversion_pct) FILTER (WHERE s.is_bottleneck)     AS bottleneck_pct,
           bool_or(s.enough_data)                                   AS any_enough
      FROM s GROUP BY s.group_key, s.group_position, s.is_total)
  SELECT w.group_key, w.group_position, w.is_total,
         w.leads, w.handled, w.deals, w.quotation, w.negotiation, w.po, w.done,
         (SELECT count(*) FROM c WHERE c.is_lost AND (w.is_total OR c.group_key = w.group_key))::int,
         (SELECT count(*) FROM c WHERE NOT c.handled AND (w.is_total OR c.group_key = w.group_key))::int,
         w.pct_handled, w.pct_deal, w.pct_quotation, w.pct_negotiation, w.pct_po, w.pct_done,
         round(w.done * 100.0 / NULLIF(w.leads, 0))::int,
         w.bottleneck_step, w.bottleneck_pct,
         CASE WHEN w.bottleneck_step IS NOT NULL THEN 'found' WHEN w.any_enough THEN 'none' ELSE 'insufficient' END
    FROM w
   ORDER BY w.group_position
$$;

-- ───────── 5. Traceability on each lead ─────────
-- Same columns as 006, plus where the lead came from. The landing page comes from the tracked
-- WhatsApp click or, for a website form, from the form's page_url.
CREATE OR REPLACE VIEW v_leads_enriched AS
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
       (l.status = 'new' AND l.received_at < now() - interval '2 hours') AS is_late,
       source_group(l.source_channel) AS source_group,
       a.name        AS ad_name,
       l.utm_source,
       l.utm_medium,
       l.utm_campaign,
       l.utm_content,
       COALESCE((SELECT e.landing_url FROM wa_click_events e
                  WHERE e.matched_lead_id = l.id ORDER BY e.clicked_at DESC LIMIT 1),
                ie.payload->>'page_url') AS landing_url
  FROM leads l
  JOIN contacts c ON c.id = l.contact_id
  LEFT JOIN users u ON u.id = l.owner_user_id
  LEFT JOIN ads a ON a.id = l.ad_id
  LEFT JOIN inbound_events ie ON ie.id = l.inbound_event_id;

-- The numbers on /prospek leave sample rows out, like the list.
CREATE OR REPLACE VIEW v_prospek_stats AS
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
 WHERE NOT is_sample
 GROUP BY GROUPING SETS ((owner_user_id), ());
