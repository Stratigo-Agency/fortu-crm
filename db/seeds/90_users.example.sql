-- Fortu CRM · example users, one per role. Fake names on @example.com: nobody can sign in with these.
-- The real team goes in db/seeds/90_users.local.sql (gitignored, same shape). Only an admin edits it.
-- Re-runnable: existing emails are left as they are.
INSERT INTO users (full_name, email, role) VALUES
  ('Contoh Admin',      'admin@example.com',      'admin'),
  ('Contoh CEO',        'ceo@example.com',        'ceo'),
  ('Contoh Sales Lead', 'sales.lead@example.com', 'sales_lead'),
  ('Contoh Sales',      'sales@example.com',      'sales_rep'),
  ('Contoh Marketing',  'marketing@example.com',  'marketing')
ON CONFLICT (email) DO NOTHING;
