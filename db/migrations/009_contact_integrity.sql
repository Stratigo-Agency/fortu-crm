-- 009 · Kontak and Perusahaan integrity (5 Nov 2026)
-- 1) A company name is unique ignoring letter case, enforced by the database (two saves at once can't both win).
-- 2) The "owner" of a contact or company that has no owner of its own follows the FIRST deal, so it does not
--    jump to someone else each time a deal is touched.

CREATE UNIQUE INDEX companies_name_lower_key ON companies (lower(name));

CREATE OR REPLACE FUNCTION contact_effective_owner(p_contact uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT c.owner_user_id FROM contacts c WHERE c.id = p_contact),
    (SELECT d.owner_user_id FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id
      WHERE d.contact_id = p_contact AND NOT s.is_won AND NOT s.is_lost
      ORDER BY d.created_at, d.id LIMIT 1),
    (SELECT l.owner_user_id FROM leads l
      WHERE l.contact_id = p_contact AND l.owner_user_id IS NOT NULL
      ORDER BY l.received_at DESC LIMIT 1))
$$;

CREATE OR REPLACE FUNCTION company_effective_owner(p_company uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT co.owner_user_id FROM companies co WHERE co.id = p_company),
    (SELECT d.owner_user_id FROM deals d WHERE d.company_id = p_company ORDER BY d.created_at, d.id LIMIT 1))
$$;
