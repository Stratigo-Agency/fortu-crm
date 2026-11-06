-- Fortu CRM · demo data for staging and training. NEVER for production.
-- Run it with `ALLOW_DEMO=1 npm run db:demo` (scripts/demo.mjs clears the old demo rows first, so it can be re-run).
-- Every row is marked is_sample = true; the demo reps use @demo.fortu.invalid and the products start with DEMO-.
-- `npm run db:demo:clear` takes all of it out again. People and companies are made up.
--
-- 4 reps, 25 deals: 6 in Chat, 6 in Quotation, 4 in Negotiation, 2 in PO, 4 Done deal, 3 Lost.
-- Among them: overdue next steps, stale deals, a passed close date, projects, and discounts over the limit.

-- ───────── Reps and products ─────────
INSERT INTO users (full_name, email, role, product_lines) VALUES
  ('Rina Putri (demo)',   'rina@demo.fortu.invalid',  'sales_rep', '{}'),
  ('Bagas Pratama (demo)', 'bagas@demo.fortu.invalid', 'sales_rep', '{}'),
  ('Sari Lestari (demo)', 'sari@demo.fortu.invalid',  'sales_rep', '{}'),
  ('Tono Wibowo (demo)',  'tono@demo.fortu.invalid',  'sales_rep', '{}');

INSERT INTO products (sku, name, product_line, size_inch, list_price) VALUES
  ('DEMO-IFP75', 'IFP 75" (demo)',            'IFP',       75, 45000000),
  ('DEMO-IFP86', 'IFP 86" (demo)',            'IFP',       86, 90000000),
  ('DEMO-DSS55', 'Signage Standing 55" (demo)', 'DSS',     55, 42000000),
  ('DEMO-LED25', 'LED Indoor P2.5 per kabinet (demo)', 'LED', NULL, 6500000),
  ('DEMO-OPS',   'Mini PC OPS (demo)',        'accessory', NULL, 8000000);

-- ───────── Deals ─────────
-- One row per deal. Dates are days from today (Jakarta); a negative step_off means the next step is late.
-- idle_days: days since the deal was last touched (stale when above the stage's limit).
CREATE TEMP TABLE demo_deals (
  n int, name text, company text, contact text, rep int, stage text, est bigint,
  sku1 text, qty1 int, price1 bigint, sku2 text, qty2 int, price2 bigint,
  close_off int, step text, step_off int, age_days int, idle_days int,
  lost text, competitor text, closed_ago int
) ON COMMIT DROP;

INSERT INTO demo_deals VALUES
  -- Chat masuk
  (1,  'Paket kelas SMA Harapan',        'SMA Harapan Bangsa',   'Ibu Wati Handayani',  1, 'chat',        120000000, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Telepon wali kelas',      2, 3,  0, NULL, NULL, NULL),
  (2,  'Signage lobi Klinik Sehat',      'Klinik Sehat Medika',  'Dr. Anton Gunawan',   2, 'chat',         45000000, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Kirim katalog',          -3, 6,  1, NULL, NULL, NULL),
  (3,  'IFP ruang rapat PT Maju',        'PT Maju Bersama',      'Pak Hendra Saputra',  3, 'chat',         90000000, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Follow up WA',             0, 2,  0, NULL, NULL, NULL),
  (4,  'Videowall mal Cahaya',           'Mal Cahaya Raya',      'Pak Dedi Kurniawan',  4, 'chat',        300000000, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Jadwalkan survei',         5, 9,  5, NULL, NULL, NULL),
  (5,  'Signage kafe Senja',             'Kafe Senja',           'Mbak Dewi Anggraini', 1, 'chat',         25000000, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Kirim contoh konten',     -1, 4,  1, NULL, NULL, NULL),
  (6,  'IFP kampus Nusantara',           'Universitas Nusantara','Pak Budi Santoso',    2, 'chat',        180000000, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Atur jadwal demo',         1, 2,  0, NULL, NULL, NULL),
  -- Quotation
  (7,  'IFP 75 SMP Cendekia',            'SMP Cendekia',         'Ibu Ratna Sari',      1, 'quotation',  0, 'DEMO-IFP75', 4, 45000000, NULL, NULL, NULL, 14, 'Kirim quotation revisi',  2, 12, 1, NULL, NULL, NULL),
  (8,  'Signage standing Bank Mitra',    'Bank Mitra Sejahtera', 'Pak Rizki Fauzi',     2, 'quotation',  0, 'DEMO-DSS55', 3, 42000000, NULL, NULL, NULL, 10, 'Tanya keputusan cabang', -2, 15, 1, NULL, NULL, NULL),
  (9,  'Videowall Hotel Samudra',        'Hotel Samudra',        'Bu Maya Kusuma',      3, 'quotation',  0, 'DEMO-LED25', 24, 6500000, NULL, NULL, NULL, 21, 'Kirim gambar instalasi',  3, 20, 2, NULL, NULL, NULL),
  (10, 'IFP 86 Universitas Bina',        'Universitas Bina Karya','Pak Agus Salim',     4, 'quotation',  0, 'DEMO-IFP86', 4, 90000000, NULL, NULL, NULL, 30, 'Presentasi ke rektorat',   6, 25, 1, NULL, NULL, NULL),
  (11, 'IFP 75 SD Pelita',               'SD Pelita Harapan',    'Ibu Sinta Marlina',   1, 'quotation',  0, 'DEMO-IFP75', 6, 36000000, NULL, NULL, NULL, 12, 'Minta persetujuan diskon', 1, 8,  0, NULL, NULL, NULL),
  (12, 'Signage lobi RS Bunda',          'RS Bunda Mulia',       'Dr. Lisa Permata',    2, 'quotation',  0, 'DEMO-DSS55', 2, 42000000, NULL, NULL, NULL, 7,  'Follow up quotation',     1, 18, 8, NULL, NULL, NULL),
  -- Negotiation
  (13, 'IFP 75 Yayasan Mulia',           'Yayasan Mulia Abadi',  'Pak Joko Widodo',     3, 'negotiation',0, 'DEMO-IFP75', 8, 43000000, NULL, NULL, NULL, 7,  'Nego harga final',        1, 30, 1, NULL, NULL, NULL),
  (14, 'Signage showroom Auto Prima',    'Auto Prima Motor',     'Pak Eko Prasetyo',    4, 'negotiation',0, 'DEMO-DSS55', 5, 40000000, NULL, NULL, NULL, -2, 'Telepon manajer',         -4, 35, 12, NULL, NULL, NULL),
  (15, 'IFP 86 Dinas Pendidikan',        'Dinas Pendidikan Kota','Ibu Yuni Astuti',     1, 'negotiation',0, 'DEMO-IFP86', 5, 82000000, NULL, NULL, NULL, 20, 'Siapkan dokumen tender',  4, 40, 2, NULL, NULL, NULL),
  (16, 'IFP 75 dan OPS Kantor Notaris',  'Kantor Notaris Hadi',  'Pak Hadi Wijaya',     2, 'negotiation',0, 'DEMO-IFP75', 2, 45000000, 'DEMO-OPS', 2, 8000000, 5, 'Kirim invoice proforma',  2, 22, 1, NULL, NULL, NULL),
  -- PO
  (17, 'LED atrium Grand Mall',          'Grand Mall Indah',     'Pak Teguh Raharjo',   3, 'po',         0, 'DEMO-LED25', 40, 6200000, NULL, NULL, NULL, 9,  'Atur jadwal pengiriman',  3, 50, 1, NULL, NULL, NULL),
  (18, 'IFP 75 SMK Teknologi',           'SMK Teknologi Nusa',   'Ibu Fitri Handayani', 4, 'po',         0, 'DEMO-IFP75', 10, 40000000, NULL, NULL, NULL, 4,  'Konfirmasi pembayaran',   2, 45, 0, NULL, NULL, NULL),
  -- Done deal (closed_ago = days since payment)
  (19, 'IFP SMA Negeri 3',               'SMA Negeri 3',         'Pak Wahyu Nugroho',   1, 'done',       0, 'DEMO-IFP75', 6, 44000000, NULL, NULL, NULL, -2, NULL, NULL, 40, 2, NULL, NULL, 2),
  (20, 'Signage Resto Lestari',          'Resto Lestari',        'Ibu Lestari Dewi',    2, 'done',       0, 'DEMO-DSS55', 2, 42000000, NULL, NULL, NULL, -12, NULL, NULL, 45, 12, NULL, NULL, 12),
  (21, 'IFP 75 Sekolah Alam',            'Sekolah Alam Mentari', 'Ibu Nia Kurnia',      3, 'done',       0, 'DEMO-IFP75', 12, 41000000, NULL, NULL, NULL, -38, NULL, NULL, 70, 38, NULL, NULL, 38),
  (22, 'LED lobi PT Kencana',            'PT Kencana Utama',     'Pak Bambang Hartono', 4, 'done',       0, 'DEMO-LED25', 30, 6400000, NULL, NULL, NULL, -66, NULL, NULL, 95, 66, NULL, NULL, 66),
  -- Lost
  (23, 'IFP 75 TK Ceria',                'TK Ceria Bunda',       'Ibu Rini Susanti',    1, 'lost',       0, 'DEMO-IFP75', 3, 45000000, NULL, NULL, NULL, -6, NULL, NULL, 30, 6, 'harga', 'BrandX', 6),
  (24, 'Signage Bank Daerah',            'Bank Daerah Sentosa',  'Pak Andi Firmansyah', 2, 'lost',       0, 'DEMO-DSS55', 4, 42000000, NULL, NULL, NULL, -21, NULL, NULL, 50, 21, 'kompetitor', 'Samsung', 21),
  (25, 'Videowall Studio Lima',          'Studio Lima Kreatif',  'Mas Reza Mahendra',   3, 'lost',   60000000, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 60, 45, 'timing', NULL, 45);

DO $$
DECLARE
  r demo_deals%ROWTYPE;
  v_rep uuid; v_company uuid; v_contact uuid; v_deal uuid;
  reps uuid[];
BEGIN
  SELECT array_agg(id ORDER BY n) INTO reps
    FROM (VALUES (1, 'rina'), (2, 'bagas'), (3, 'sari'), (4, 'tono')) AS m(n, who)
    JOIN users u ON u.email = m.who || '@demo.fortu.invalid';

  FOR r IN SELECT * FROM demo_deals ORDER BY n LOOP
    v_rep := reps[r.rep];
    PERFORM set_config('app.user_id', v_rep::text, true);

    INSERT INTO companies (name, industry, city, owner_user_id, is_sample)
    VALUES (r.company, CASE WHEN r.n % 3 = 0 THEN 'education' WHEN r.n % 3 = 1 THEN 'corporate' ELSE 'retail_fnb' END,
            (ARRAY['Jakarta','Bandung','Surabaya','Medan','Semarang'])[1 + r.n % 5], v_rep, true)
    RETURNING id INTO v_company;

    INSERT INTO contacts (phone_e164, full_name, job_title, company_id, owner_user_id, is_sample)
    VALUES ('+628880000' || lpad(r.n::text, 3, '0'), r.contact, 'Pengambil keputusan', v_company, v_rep, true)
    RETURNING id INTO v_contact;

    -- every deal starts in Chat; products and the close date come before the move, as the stage rules want
    INSERT INTO deals (name, contact_id, company_id, owner_user_id, stage_id, est_amount, next_step, next_step_date,
                       demo_date, is_sample)
    SELECT r.name, v_contact, v_company, v_rep, s.id, r.est,
           COALESCE(r.step, 'Telepon'), jakarta_today() + COALESCE(r.step_off, 0),
           CASE WHEN r.stage IN ('negotiation', 'po', 'done') THEN jakarta_today() - 10 END, true
      FROM pipeline_stages s WHERE s.key = 'chat'
    RETURNING id INTO v_deal;

    IF r.sku1 IS NOT NULL THEN
      INSERT INTO deal_line_items (deal_id, product_id, qty, unit_price)
      SELECT v_deal, p.id, r.qty1, r.price1 FROM products p WHERE p.sku = r.sku1;
    END IF;
    IF r.sku2 IS NOT NULL THEN
      INSERT INTO deal_line_items (deal_id, product_id, qty, unit_price)
      SELECT v_deal, p.id, r.qty2, r.price2 FROM products p WHERE p.sku = r.sku2;
    END IF;

    IF r.stage <> 'chat' THEN
      UPDATE deals d
         SET expected_close_date = CASE WHEN r.close_off IS NOT NULL THEN jakarta_today() + r.close_off END,
             lost_reason = r.lost::lost_reason,
             competitor = r.competitor,
             closed_on = CASE WHEN r.closed_ago IS NOT NULL THEN jakarta_today() - r.closed_ago END,
             stage_id = s.id
        FROM pipeline_stages s
       WHERE d.id = v_deal AND s.key = r.stage;
    END IF;
  END LOOP;
END $$;

-- ───────── Make the history look lived in ─────────
-- The stage rules stamp "now" on every change, so the clock is set back with the trigger off (same transaction).
ALTER TABLE deals DISABLE TRIGGER deal_stage_upd;
UPDATE deals d
   SET created_at = now() - make_interval(days => x.age_days),
       updated_at = now() - make_interval(days => x.idle_days),
       stage_entered_at = now() - make_interval(days => x.idle_days),
       closed_at = CASE WHEN d.closed_on IS NOT NULL THEN (d.closed_on + time '12:00') AT TIME ZONE 'Asia/Jakarta' END
  FROM demo_deals x
  JOIN contacts c ON c.phone_e164 = '+628880000' || lpad(x.n::text, 3, '0')
 WHERE d.contact_id = c.id AND d.is_sample;
ALTER TABLE deals ENABLE TRIGGER deal_stage_upd;

UPDATE deal_stage_history h
   SET changed_at = CASE WHEN h.from_stage_id IS NULL THEN d.created_at ELSE d.stage_entered_at END
  FROM deals d
 WHERE h.deal_id = d.id AND d.is_sample;

-- ───────── Prospek: chats that are not a deal yet ─────────
-- Direct inserts are fine here: this is sample data, not a lead coming in (real ones go through ingestLead()).
WITH reps AS (
  SELECT id, row_number() OVER (ORDER BY email) AS i FROM users WHERE email LIKE '%@demo.fortu.invalid'
), seed (n, name, msg, channel, line, ago_min) AS (VALUES
  (1, 'Pak Irfan Maulana',  'Halo kak, mau tanya harga IFP 65 inch untuk 3 kelas',  'meta_ctwa',       'IFP', 25),
  (2, 'Ibu Tika Anggraeni', 'Selamat siang, ada signage standing untuk lobi kantor?', 'website_form',   'DSS', 200),
  (3, 'Pak Roni Hakim',     'Tanya videowall LED ukuran 3x2 meter, berapa kisarannya?', 'meta_ctwa',    'LED', 600),
  (4, 'Mbak Putri Ayu',     'Kak, bisa demo IFP di sekolah kami minggu depan?',     'referral',        'IFP', 1500),
  (5, 'Pak Gunawan',        'Mau beli 10 unit signage untuk cabang, minta penawaran', 'whatsapp_direct','DSS', 60),
  (6, 'Ibu Hesti Rahma',    'Info harga IFP 86 inch dan garansinya ya',             'instagram_dm',    'IFP', 2900)
), c AS (
  INSERT INTO contacts (phone_e164, full_name, owner_user_id, is_sample)
  SELECT '+628881000' || lpad(s.n::text, 3, '0'), s.name, r.id, true
    FROM seed s JOIN reps r ON r.i = 1 + (s.n % 4)
  RETURNING id, phone_e164, owner_user_id
)
INSERT INTO leads (contact_id, owner_user_id, source_channel, product_interest, first_message, received_at, logged_at, is_sample)
SELECT c.id, c.owner_user_id, s.channel::source_channel, s.line::product_line, s.msg,
       now() - make_interval(mins => s.ago_min), now() - make_interval(mins => s.ago_min), true
  FROM seed s JOIN c ON c.phone_e164 = '+628881000' || lpad(s.n::text, 3, '0');
