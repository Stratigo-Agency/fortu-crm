-- 016 · Lead funnel by source (6 Nov 2026, Pak Jovian's feedback)
-- How many leads came in, where each one came from, and at which step of the sales flow they stop.
-- 1) source_groups + source_channel_groups + source_group(): the five groups the report shows.
-- 2) lead_funnel_cohort(): the leads received in a period (Jakarta dates), how far each one got, and
--    whether it stopped or is still running; re-entry chats and 'bukan calon pembeli' are flagged.
-- 3) lead_funnel(): one row per source group (and the total) with the steps inside: how many entered,
--    passed, stopped and are still running, the conversion, the usual days per stage, and the bottleneck.
-- 4) v_leads_enriched: the source group, ad name, UTM and landing page of each lead (traceability);
--    v_prospek_stats leaves sample rows out and splits by source group.
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

-- A step is named the bottleneck only when at least this many leads stopped there.
INSERT INTO app_settings (key, value) VALUES ('funnel_min_entering', '5') ON CONFLICT (key) DO NOTHING;

-- ───────── 2. The cohort: leads received in [p_from, p_to] ─────────
-- owner      = the current owner of the lead's first deal, else the lead's own owner. Same rule as the deal
--              numbers in the rest of Laporan: a hand-over from rep A to rep B moves the lead to B.
-- is_reentry = the contact already had an open deal when this chat came in ('chat lanjutan'). Not a new
--              lead: left out of the funnel and only counted.
-- not_buyer  = disqualified as 'bukan calon pembeli' (spam, wrong number) and no deal: still a lead and
--              handled, but not part of Ditangani → Jadi deal.
-- handled    = first response recorded, status past 'new', or already a deal.
-- reached    = the furthest stage position any of its deals ever reached (stage history + current stage).
--              Skipping a stage counts as passing it: a deal created at PO has passed Quotation.
--              Done counts only while the deal is Done now (Done → PO reopened is back at PO). 0 = no deal.
-- is_lost    = every deal of the lead ended Lost (and none is Done).
-- is_running = still moving: an open deal that is not stale (no change for longer than its stage's
--              stale_after_days, the same rule as the board), or, without a deal, an open lead younger
--              than the Chat masuk stage's stale_after_days. A lead that did not pass a step and is not
--              running has stopped there.
CREATE FUNCTION lead_funnel_cohort(p_from date, p_to date, p_owner uuid DEFAULT NULL)
RETURNS TABLE (lead_id uuid, group_key text, owner_user_id uuid, received_at timestamptz,
               is_reentry boolean, not_buyer boolean, handled boolean, has_deal boolean,
               reached smallint, is_won boolean, is_lost boolean, is_running boolean)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT l.id, l.contact_id, source_group(l.source_channel) AS group_key, l.status, l.disqualify_reason,
           l.first_response_at, l.received_at, l.deal_id, l.owner_user_id
      FROM leads l
     WHERE NOT l.is_sample
       AND (l.received_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_from AND p_to),
  lead_deals AS (
    SELECT b.id AS lead_id, d.id AS deal_id, d.owner_user_id, d.created_at, d.updated_at,
           s.position, s.is_won, s.is_lost, s.stale_after_days
      FROM base b
      JOIN deals d ON (d.lead_id = b.id OR d.id = b.deal_id) AND NOT d.is_sample
      JOIN pipeline_stages s ON s.id = d.stage_id),
  per_lead AS (
    SELECT ld.lead_id,
           max(COALESCE(GREATEST(CASE WHEN NOT ld.is_lost THEN ld.position END,
                                 (SELECT max(hs.position) FROM deal_stage_history h
                                    JOIN pipeline_stages hs ON hs.id = h.to_stage_id
                                   WHERE h.deal_id = ld.deal_id AND NOT hs.is_won AND NOT hs.is_lost)),
                        (SELECT min(position) FROM pipeline_stages WHERE NOT is_won AND NOT is_lost))) AS reached,
           (array_agg(ld.owner_user_id ORDER BY ld.created_at, ld.deal_id))[1] AS deal_owner,
           bool_or(ld.is_won) AS is_won,
           bool_and(ld.is_lost) AS all_lost,
           bool_or(NOT ld.is_won AND NOT ld.is_lost
                   AND now() - ld.updated_at <= make_interval(days => ld.stale_after_days)) AS fresh_open
      FROM lead_deals ld
     GROUP BY ld.lead_id)
  SELECT b.id,
         b.group_key,
         COALESCE(p.deal_owner, b.owner_user_id),
         b.received_at,
         EXISTS (SELECT 1 FROM deals d
                  WHERE d.contact_id = b.contact_id AND NOT d.is_sample
                    AND d.created_at < b.received_at
                    AND d.lead_id IS DISTINCT FROM b.id
                    -- the deal's stage when the chat came in was still open
                    AND NOT COALESCE((SELECT hs.is_won OR hs.is_lost FROM deal_stage_history h
                                        JOIN pipeline_stages hs ON hs.id = h.to_stage_id
                                       WHERE h.deal_id = d.id AND h.changed_at <= b.received_at
                                       ORDER BY h.changed_at DESC, h.id DESC LIMIT 1), false)),
         (b.status = 'disqualified' AND b.disqualify_reason = 'not_buyer' AND p.lead_id IS NULL),
         (b.status <> 'new' OR b.first_response_at IS NOT NULL OR p.lead_id IS NOT NULL),
         p.lead_id IS NOT NULL,
         COALESCE(p.reached, 0)::smallint,
         COALESCE(p.is_won, false),
         COALESCE(p.all_lost AND NOT p.is_won, false),
         CASE WHEN p.lead_id IS NOT NULL THEN COALESCE(p.fresh_open, false)
              ELSE COALESCE(b.status IN ('new', 'contacted', 'qualified', 'converted')
                            AND now() - b.received_at <= make_interval(days => (SELECT stale_after_days FROM pipeline_stages WHERE key = 'chat')),
                            false) END
    FROM base b
    LEFT JOIN per_lead p ON p.lead_id = b.id
   WHERE p_owner IS NULL OR COALESCE(p.deal_owner, b.owner_user_id) = p_owner
$$;

-- ───────── 3. The funnel: one row per source group (and the total), steps inside ─────────
-- Steps (named after where they lead): handled, deal, quotation, negotiation, po, done.
-- Per step: entered = leads that reached the step before; passed = leads that reached this one;
--   stopped = entered, did not pass, and are not running (Lost, disqualified or stale);
--   running = entered, did not pass, still moving ('masih berjalan').
--   conversion_pct = passed / (passed + stopped): young leads still in progress do not count against a step.
--   median_days = median days a deal of the cohort stayed in the stage of that step (Chat masuk for
--   'deal', then Quotation, Negotiation, PO), from completed stays only (entered and left that stage).
-- A step is the bottleneck when at least funnel_min_entering leads stopped there and its conversion is
-- the lowest of those steps; ties name every tied step.
-- bottleneck_status: 'found'; 'insufficient' (some leads stopped, but no step has enough); 'none'
-- (no lead stopped at any step).
-- Re-entry chats are left out (counted in reentry); not_buyer leads are left out of Ditangani → Jadi deal.
-- outside_deals / outside_done (total row only): deals created or Done this period without a lead in
-- this funnel (repeat orders, older leads), so the funnel's Done deal and the Done deal figure differ.
CREATE FUNCTION lead_funnel(p_from date, p_to date, p_owner uuid DEFAULT NULL)
RETURNS TABLE (group_key text, group_position smallint, is_total boolean,
               leads int, handled int, deals int, quotation int, negotiation int, po int, done int,
               lost int, unhandled int, not_buyer int, reentry int, pct_lead_to_done int,
               bottleneck_steps text[], bottleneck_pct int, bottleneck_status text,
               outside_deals int, outside_done int, steps jsonb)
LANGUAGE sql STABLE AS $$
  WITH c AS MATERIALIZED (SELECT * FROM lead_funnel_cohort(p_from, p_to, p_owner)),
  pos AS (
    SELECT max(position) FILTER (WHERE key = 'quotation')   AS quotation,
           max(position) FILTER (WHERE key = 'negotiation') AS negotiation,
           max(position) FILTER (WHERE key = 'po')          AS po
      FROM pipeline_stages),
  steps(step_key, step_position, stage_key) AS (
    VALUES ('handled', 1::smallint, NULL::text), ('deal', 2::smallint, 'chat'), ('quotation', 3::smallint, 'quotation'),
           ('negotiation', 4::smallint, 'negotiation'), ('po', 5::smallint, 'po'), ('done', 6::smallint, NULL)),
  groups AS (
    SELECT key AS group_key, position AS group_position, false AS is_total FROM source_groups
    UNION ALL SELECT 'total', 0::smallint, true),
  lead_steps AS (
    SELECT c.lead_id, c.group_key, s.step_key, x.entered, x.passed,
           (x.entered AND NOT x.passed AND NOT c.is_running) AS stopped
      FROM c CROSS JOIN pos CROSS JOIN steps s
      CROSS JOIN LATERAL (SELECT
           CASE s.step_key
             WHEN 'handled'     THEN true
             WHEN 'deal'        THEN c.handled AND NOT c.not_buyer
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
             WHEN 'done'        THEN c.is_won END AS passed) x
     WHERE NOT c.is_reentry),
  cohort_deals AS (
    SELECT DISTINCT c.group_key, d.id AS deal_id
      FROM c
      JOIN leads l ON l.id = c.lead_id
      JOIN deals d ON (d.lead_id = l.id OR d.id = l.deal_id) AND NOT d.is_sample
     WHERE NOT c.is_reentry),
  -- Completed stays: from entering a stage to the next move of the same deal.
  stays AS (
    SELECT x.group_key, x.stage_key, x.days FROM (
      SELECT cd.group_key, hs.key AS stage_key,
             extract(epoch FROM (lead(h.changed_at) OVER (PARTITION BY cd.group_key, h.deal_id ORDER BY h.changed_at, h.id)
                                 - h.changed_at)) / 86400 AS days
        FROM cohort_deals cd
        JOIN deal_stage_history h ON h.deal_id = cd.deal_id
        JOIN pipeline_stages hs ON hs.id = h.to_stage_id) x
     WHERE x.days IS NOT NULL),
  agg AS (
    SELECT g.group_key, g.group_position, g.is_total, s.step_key, s.step_position,
           count(ls.lead_id) FILTER (WHERE ls.entered)::int AS entered,
           count(ls.lead_id) FILTER (WHERE ls.passed)::int  AS passed,
           count(ls.lead_id) FILTER (WHERE ls.stopped)::int AS stopped,
           (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY st.days)::numeric, 1)
              FROM stays st
             WHERE st.stage_key = s.stage_key AND (g.is_total OR st.group_key = g.group_key)) AS median_days
      FROM groups g
      CROSS JOIN steps s
      LEFT JOIN lead_steps ls ON ls.step_key = s.step_key AND (g.is_total OR ls.group_key = g.group_key)
     GROUP BY g.group_key, g.group_position, g.is_total, s.step_key, s.step_position, s.stage_key),
  scored AS (
    SELECT a.*,
           a.entered - a.passed - a.stopped AS running,
           round(a.passed * 100.0 / NULLIF(a.passed + a.stopped, 0))::int AS conversion_pct,
           (a.stopped > 0 AND a.stopped >= COALESCE(setting_num('funnel_min_entering'), 5)) AS enough
      FROM agg a),
  marked AS (
    SELECT sc.*,
           COALESCE(sc.enough AND sc.conversion_pct =
                    min(sc.conversion_pct) FILTER (WHERE sc.enough) OVER (PARTITION BY sc.group_key), false) AS is_bottleneck
      FROM scored sc),
  wide AS (
    SELECT m.group_key, m.group_position, m.is_total,
           max(m.entered) FILTER (WHERE m.step_key = 'handled')     AS leads,
           max(m.passed)  FILTER (WHERE m.step_key = 'handled')     AS handled,
           max(m.passed)  FILTER (WHERE m.step_key = 'deal')        AS deals,
           max(m.passed)  FILTER (WHERE m.step_key = 'quotation')   AS quotation,
           max(m.passed)  FILTER (WHERE m.step_key = 'negotiation') AS negotiation,
           max(m.passed)  FILTER (WHERE m.step_key = 'po')          AS po,
           max(m.passed)  FILTER (WHERE m.step_key = 'done')        AS done,
           array_agg(m.step_key ORDER BY m.step_position) FILTER (WHERE m.is_bottleneck) AS bottleneck_steps,
           min(m.conversion_pct) FILTER (WHERE m.is_bottleneck)      AS bottleneck_pct,
           bool_or(m.stopped > 0)                                   AS any_stopped,
           jsonb_agg(jsonb_build_object(
             'step', m.step_key, 'entered', m.entered, 'passed', m.passed, 'stopped', m.stopped, 'running', m.running,
             'pct', m.conversion_pct, 'median_days', m.median_days, 'enough', m.enough, 'is_bottleneck', m.is_bottleneck)
             ORDER BY m.step_position)                              AS steps
      FROM marked m
     GROUP BY m.group_key, m.group_position, m.is_total),
  outside AS (
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE s.is_won AND d.closed_on BETWEEN p_from AND p_to)::int AS done
      FROM deals d
      JOIN pipeline_stages s ON s.id = d.stage_id
     WHERE NOT d.is_sample
       AND (p_owner IS NULL OR d.owner_user_id = p_owner)
       AND ((d.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_from AND p_to
            OR (s.is_won AND d.closed_on BETWEEN p_from AND p_to))
       AND NOT EXISTS (SELECT 1 FROM c JOIN leads l ON l.id = c.lead_id
                        WHERE NOT c.is_reentry AND (d.lead_id = l.id OR l.deal_id = d.id)))
  SELECT w.group_key, w.group_position, w.is_total,
         w.leads, w.handled, w.deals, w.quotation, w.negotiation, w.po, w.done,
         (SELECT count(*) FROM c WHERE NOT c.is_reentry AND c.is_lost      AND (w.is_total OR c.group_key = w.group_key))::int,
         (SELECT count(*) FROM c WHERE NOT c.is_reentry AND NOT c.handled  AND (w.is_total OR c.group_key = w.group_key))::int,
         (SELECT count(*) FROM c WHERE NOT c.is_reentry AND c.not_buyer    AND (w.is_total OR c.group_key = w.group_key))::int,
         (SELECT count(*) FROM c WHERE c.is_reentry                        AND (w.is_total OR c.group_key = w.group_key))::int,
         round(w.done * 100.0 / NULLIF(w.leads, 0))::int,
         w.bottleneck_steps,
         w.bottleneck_pct,
         CASE WHEN w.bottleneck_steps IS NOT NULL THEN 'found' WHEN w.any_stopped THEN 'insufficient' ELSE 'none' END,
         CASE WHEN w.is_total THEN o.n END,
         CASE WHEN w.is_total THEN o.done END,
         w.steps
    FROM wide w CROSS JOIN outside o
   ORDER BY w.group_position
$$;

-- ───────── 4. Traceability on each lead ─────────
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

-- The numbers on /prospek leave sample rows out, like the list, and follow its source filter:
-- one row per owner and source group, with the totals over owners (is_total) and over groups (all_groups).
DROP VIEW v_prospek_stats;
CREATE VIEW v_prospek_stats AS
SELECT owner_user_id,
       source_group,
       (GROUPING(owner_user_id) = 1) AS is_total,
       (GROUPING(source_group) = 1)  AS all_groups,
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
 GROUP BY GROUPING SETS ((owner_user_id, source_group), (owner_user_id), (source_group), ());
