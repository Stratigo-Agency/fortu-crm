-- 015 · Indexes the report and list views were missing (T22, 6 Nov 2026)
--
-- Found with EXPLAIN ANALYZE on a copy with demo data x10 (3.000 deals, 8.000 contacts, 20.000 prospects): the
-- views look up a deal's product lines, and a contact's or company's deals, one row at a time, and each lookup
-- read the whole table. Numbers in docs/deploy.md.
-- Numbered 015 on purpose: the open pull requests for pricing and stock use 013 and 014.

-- v_pipeline_board, v_deals_enriched and everything built on them: the lines of each deal.
CREATE INDEX IF NOT EXISTS deal_line_items_deal_id_idx ON deal_line_items (deal_id);

-- contact_effective_owner(), v_contact_activity (Kontak) and v_companies_enriched (Perusahaan): the deals of one
-- contact or company.
CREATE INDEX IF NOT EXISTS deals_contact_id_idx ON deals (contact_id);
CREATE INDEX IF NOT EXISTS deals_company_id_idx ON deals (company_id);
