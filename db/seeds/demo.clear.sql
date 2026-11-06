-- Fortu CRM · removes the demo data (every row marked is_sample, the DEMO- products, the demo- ads, clicks and
-- web forms, and the demo reps).
-- Safe on any database: it only touches rows the demo seed made. Run it with `npm run db:demo:clear`.
UPDATE contacts SET first_lead_id = NULL WHERE first_lead_id IN (SELECT id FROM leads WHERE is_sample);
UPDATE leads SET deal_id = NULL WHERE deal_id IN (SELECT id FROM deals WHERE is_sample);
UPDATE deals SET parent_deal_id = NULL WHERE is_sample AND parent_deal_id IS NOT NULL;
UPDATE deals SET lead_id = NULL WHERE lead_id IN (SELECT id FROM leads WHERE is_sample) AND NOT is_sample;
UPDATE wa_click_events SET matched_lead_id = NULL WHERE matched_lead_id IN (SELECT id FROM leads WHERE is_sample);
-- what people did on sample rows while testing: notes, calls, reminders
DELETE FROM activities
 WHERE deal_id IN (SELECT id FROM deals WHERE is_sample)
    OR lead_id IN (SELECT id FROM leads WHERE is_sample)
    OR contact_id IN (SELECT id FROM contacts WHERE is_sample)
    OR user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.fortu.invalid');
DELETE FROM notifications
 WHERE deal_id IN (SELECT id FROM deals WHERE is_sample)
    OR lead_id IN (SELECT id FROM leads WHERE is_sample)
    OR user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.fortu.invalid');
DELETE FROM deals WHERE is_sample;
DELETE FROM wa_click_events WHERE ref_code LIKE 'demo-%';
DELETE FROM leads WHERE is_sample;
DELETE FROM inbound_events WHERE provider = 'web_form' AND external_id LIKE 'demo-%';
DELETE FROM contacts WHERE is_sample;
DELETE FROM companies WHERE is_sample;
DELETE FROM products WHERE sku LIKE 'DEMO-%';
-- the demo ads (meta ids demo-…): a real lead that picked up a demo code while testing loses only that link
UPDATE leads SET ad_id = NULL WHERE ad_id IN (SELECT id FROM ads WHERE meta_ad_id LIKE 'demo-a-%');
DELETE FROM ad_insights_daily WHERE ad_id IN (SELECT id FROM ads WHERE meta_ad_id LIKE 'demo-a-%');
DELETE FROM ads WHERE meta_ad_id LIKE 'demo-a-%';
DELETE FROM ad_sets WHERE meta_adset_id LIKE 'demo-s-%';
DELETE FROM ad_campaigns WHERE meta_campaign_id LIKE 'demo-c-%';
DELETE FROM users WHERE email LIKE '%@demo.fortu.invalid';
