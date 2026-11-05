-- 008 · Kontak and Perusahaan (5 Nov 2026)
-- 1) contact_effective_owner(): the contact's own sales, else the owner of its open deal, else of its latest lead.
-- 2) can_edit_contact / can_edit_company: view all, edit own (marketing never edits).
-- 3) v_contacts_enriched: one row per contact for /kontak (company, source, sales, first/last chat, open deals,
--    needs_followup from v_contacts_followup).
-- 4) v_companies_enriched: one row per company for /perusahaan (contacts, open deals, pipeline, total done, last chat).

CREATE FUNCTION contact_effective_owner(p_contact uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT c.owner_user_id FROM contacts c WHERE c.id = p_contact),
    (SELECT d.owner_user_id FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id
      WHERE d.contact_id = p_contact AND NOT s.is_won AND NOT s.is_lost
      ORDER BY d.updated_at DESC LIMIT 1),
    (SELECT l.owner_user_id FROM leads l
      WHERE l.contact_id = p_contact AND l.owner_user_id IS NOT NULL
      ORDER BY l.received_at DESC LIMIT 1))
$$;

CREATE FUNCTION can_edit_contact(p_user uuid, p_contact uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u, contacts c
     WHERE u.id = p_user AND c.id = p_contact AND u.is_active
       AND (u.role IN ('admin', 'ceo', 'sales_lead')
            OR contact_effective_owner(c.id) = u.id
            OR (contact_effective_owner(c.id) IS NULL AND u.role = 'sales_rep')))
$$;

CREATE FUNCTION company_effective_owner(p_company uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT co.owner_user_id FROM companies co WHERE co.id = p_company),
    (SELECT d.owner_user_id FROM deals d WHERE d.company_id = p_company ORDER BY d.updated_at DESC LIMIT 1))
$$;

CREATE FUNCTION can_edit_company(p_user uuid, p_company uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u, companies co
     WHERE u.id = p_user AND co.id = p_company AND u.is_active
       AND (u.role IN ('admin', 'ceo', 'sales_lead')
            OR company_effective_owner(co.id) = u.id
            OR (company_effective_owner(co.id) IS NULL AND u.role = 'sales_rep')))
$$;

CREATE VIEW v_contacts_enriched AS
SELECT f.contact_id AS id,
       f.full_name,
       c.job_title,
       c.email,
       f.phone_e164,
       f.company_id,
       co.name AS company_name,
       l.source_channel,
       contact_effective_owner(f.contact_id) AS owner_user_id,
       u.full_name AS owner_name,
       f.first_chat_at,
       f.last_chat_at,
       f.open_deals::int AS open_deals,
       f.needs_followup,
       setting_num('followup_days')::int AS followup_days
  FROM v_contacts_followup f
  JOIN contacts c ON c.id = f.contact_id
  LEFT JOIN companies co ON co.id = f.company_id
  LEFT JOIN leads l ON l.id = c.first_lead_id
  LEFT JOIN users u ON u.id = contact_effective_owner(f.contact_id);

CREATE VIEW v_companies_enriched AS
SELECT co.id,
       co.name,
       co.industry,
       co.city,
       co.website,
       company_effective_owner(co.id) AS owner_user_id,
       u.full_name AS owner_name,
       (SELECT count(*) FROM contacts c WHERE c.company_id = co.id)::int AS contact_count,
       (SELECT count(*) FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id
         WHERE d.company_id = co.id AND NOT s.is_won AND NOT s.is_lost)::int AS open_deals,
       COALESCE((SELECT sum(d.amount) FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id
         WHERE d.company_id = co.id AND NOT s.is_won AND NOT s.is_lost), 0) AS pipeline,
       COALESCE((SELECT sum(d.amount) FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id
         WHERE d.company_id = co.id AND s.is_won), 0) AS total_done,
       (SELECT max(f.last_chat_at) FROM v_contacts_followup f WHERE f.company_id = co.id) AS last_chat_at
  FROM companies co
  LEFT JOIN users u ON u.id = company_effective_owner(co.id);
