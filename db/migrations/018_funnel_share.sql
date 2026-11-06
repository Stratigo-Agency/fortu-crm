-- 018 · Funnel percentages read as a plain share (MAR-162, after review)
-- The percentage shown per step is now passed / entered: the share of the leads that reached the step
-- before. 016 showed passed / (passed + stopped), which leaves running leads out and read wrongly next
-- to the counts (Ditangani 25 · 96% beside Belum ditangani 11 of 36).
-- passed / (passed + stopped) stays, as finished_pct, only to judge the bottleneck: leads still running
-- do not count against a step. bottleneck_pct is that finished share.
-- Numbered 018 because the open WhatsApp PR uses 017.

-- ───────── 3. The funnel: one row per source group (and the total), steps inside ─────────
-- Steps (named after where they lead): handled, deal, quotation, negotiation, po, done.
-- Per step: entered = leads that reached the step before; passed = leads that reached this one;
--   stopped = entered, did not pass, and are not running (Lost, disqualified or stale);
--   running = entered, did not pass, still moving ('masih berjalan').
--   share_pct = passed / entered: the share shown next to the count.
--   finished_pct = passed / (passed + stopped): young leads still in progress do not count against a step;
--   used only to judge the bottleneck.
--   median_days = median days a deal of the cohort stayed in the stage of that step (Chat masuk for
--   'deal', then Quotation, Negotiation, PO), from completed stays only (entered and left that stage).
-- A step is the bottleneck when at least funnel_min_entering leads stopped there and its finished_pct
-- is the lowest of those steps; ties name every tied step.
-- bottleneck_status: 'found'; 'insufficient' (some leads stopped, but no step has enough); 'none'
-- (no lead stopped at any step).
-- Re-entry chats are left out (counted in reentry); not_buyer leads are left out of Ditangani → Jadi deal.
-- outside_deals / outside_done (total row only): deals created or Done this period without a lead in
-- this funnel (repeat orders, older leads), so the funnel's Done deal and the Done deal figure differ.
CREATE OR REPLACE FUNCTION lead_funnel(p_from date, p_to date, p_owner uuid DEFAULT NULL)
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
           round(a.passed * 100.0 / NULLIF(a.entered, 0))::int AS share_pct,
           round(a.passed * 100.0 / NULLIF(a.passed + a.stopped, 0))::int AS finished_pct,
           (a.stopped > 0 AND a.stopped >= COALESCE(setting_num('funnel_min_entering'), 5)) AS enough
      FROM agg a),
  marked AS (
    SELECT sc.*,
           COALESCE(sc.enough AND sc.finished_pct =
                    min(sc.finished_pct) FILTER (WHERE sc.enough) OVER (PARTITION BY sc.group_key), false) AS is_bottleneck
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
           min(m.finished_pct) FILTER (WHERE m.is_bottleneck)        AS bottleneck_pct,
           bool_or(m.stopped > 0)                                   AS any_stopped,
           jsonb_agg(jsonb_build_object(
             'step', m.step_key, 'entered', m.entered, 'passed', m.passed, 'stopped', m.stopped, 'running', m.running,
             'pct', m.share_pct, 'finished_pct', m.finished_pct, 'median_days', m.median_days, 'enough', m.enough, 'is_bottleneck', m.is_bottleneck)
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
