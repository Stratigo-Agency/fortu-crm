-- Fortu CRM · demo data for staging and training. NEVER for production.
-- Run it with `ALLOW_DEMO=1 npm run db:demo` (scripts/demo.mjs clears the old demo rows first, so it can be re-run).
-- Every row is marked is_sample = true; the demo reps use @demo.fortu.invalid and the products start with DEMO-.
-- `npm run db:demo:clear` takes all of it out again. People and companies are made up.
--
-- 4 reps, 25 deals: 6 in Chat, 6 in Quotation, 4 in Negotiation, 2 in PO, 4 Done deal, 3 Lost.
-- Among them: overdue next steps, stale deals, a passed close date, projects, and discounts over the limit.
-- Every deal has the lead it came from: Iklan Meta (with an ad code; 4 demo ads with 14 days of insights),
-- Website (form with UTM and page, or the WA button), Offline (event, walk-in, referral, tender) and
-- WhatsApp langsung. 10 more chats are still in Prospek. Funnel and Prospek figures leave sample rows out
-- unless the app runs with SHOW_SAMPLE_DATA=1 (staging only, docs/deploy.md section 7).
-- Demo ads use meta ids starting with demo- and codes starting with Z-; clicks and web forms use demo-.

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

-- ───────── Demo ads (Iklan Meta) and 14 days of insights ─────────
CREATE TEMP TABLE demo_ads (aid text, sid text, cid text, campaign text, adset text, line text, name text, code text) ON COMMIT DROP;
INSERT INTO demo_ads VALUES
  ('demo-a-1', 'demo-s-1', 'demo-c-1', 'Sekolah pintar (demo)', 'IFP sekolah Jabodetabek (demo)', 'IFP', 'IFP kelas pintar (demo)', 'Z-IFP-01'),
  ('demo-a-2', 'demo-s-1', 'demo-c-1', 'Sekolah pintar (demo)', 'IFP sekolah Jabodetabek (demo)', 'IFP', 'IFP 86 ruang rapat (demo)', 'Z-IFP-02'),
  ('demo-a-3', 'demo-s-2', 'demo-c-2', 'Bisnis dan ritel (demo)', 'Signage dan LED bisnis (demo)', 'DSS', 'Signage lobi (demo)', 'Z-DSS-01'),
  ('demo-a-4', 'demo-s-2', 'demo-c-2', 'Bisnis dan ritel (demo)', 'Signage dan LED bisnis (demo)', 'LED', 'Videowall LED (demo)', 'Z-LED-01');

INSERT INTO ad_campaigns (meta_campaign_id, name, objective, status)
SELECT DISTINCT cid, campaign, 'messages', 'ACTIVE' FROM demo_ads;
INSERT INTO ad_sets (meta_adset_id, campaign_id, name, product_line, daily_budget)
SELECT DISTINCT ON (x.sid) x.sid, c.id, x.adset, x.line::product_line, 300000
  FROM demo_ads x JOIN ad_campaigns c ON c.meta_campaign_id = x.cid ORDER BY x.sid;
INSERT INTO ads (meta_ad_id, ad_set_id, name, prefill_code, status)
SELECT x.aid, st.id, x.name, x.code, 'ACTIVE' FROM demo_ads x JOIN ad_sets st ON st.meta_adset_id = x.sid;

-- A quiet weekend, busier weekdays; each ad its own size.
INSERT INTO ad_insights_daily (ad_id, date, spend, impressions, reach, link_clicks, meta_conversations)
SELECT a.id, jakarta_today() - g.d,
       k.size * (CASE WHEN extract(isodow FROM jakarta_today() - g.d) >= 6 THEN 60000 ELSE 95000 END + (g.d % 4) * 7000),
       k.size * (2600 + (g.d % 5) * 310), k.size * (1900 + (g.d % 5) * 220),
       k.size * (38 + (g.d % 6) * 4), k.size * (4 + g.d % 3)
  FROM ads a
  JOIN (VALUES ('demo-a-1', 3), ('demo-a-2', 1), ('demo-a-3', 2), ('demo-a-4', 1)) k(aid, size) ON k.aid = a.meta_ad_id
 CROSS JOIN generate_series(1, 14) g(d);

-- ───────── Where each deal came from ─────────
-- lag_hours: how long before the deal was made the first chat came in. page = the landing page (website).
CREATE TEMP TABLE demo_sources (
  n int, industry text, channel text, line text, ad_code text, utm_source text, utm_medium text, utm_campaign text,
  page text, lag_hours int, msg text
) ON COMMIT DROP;

INSERT INTO demo_sources VALUES
  (1,  'education',  'meta_ctwa',       'IFP', 'Z-IFP-01', NULL, NULL, NULL, NULL, 5,  'Halo, mau info IFP untuk kelas SMA [Z-IFP-01]'),
  (2,  'hospital',   'website_form',    'DSS', NULL, 'google', 'cpc', 'signage-klinik', 'https://fortu.co.id/digital-signage?utm_source=google', 20, 'Butuh signage untuk ruang tunggu klinik'),
  (3,  'corporate',  'meta_ctwa',       'IFP', 'Z-IFP-02', NULL, NULL, NULL, NULL, 2,  'Siang kak, IFP 86 untuk ruang rapat berapa? [Z-IFP-02]'),
  (4,  'retail_fnb', 'event',           'LED', NULL, NULL, NULL, NULL, NULL, 50, 'Ketemu di pameran InfoComm Jakarta, minta penawaran videowall'),
  (5,  'retail_fnb', 'whatsapp_direct', 'DSS', NULL, NULL, NULL, NULL, NULL, 3,  'Kak, signage kecil untuk menu kafe ada?'),
  (6,  'education',  'website_wa_link', 'IFP', NULL, 'instagram', 'social', 'kampus-2026', 'https://fortu.co.id/ifp/pendidikan', 8, 'Halo Fortu, saya dari kampus, mau tanya IFP'),
  (7,  'education',  'meta_ctwa',       'IFP', 'Z-IFP-01', NULL, NULL, NULL, NULL, 26, 'Mau tanya IFP 75 untuk 4 kelas [Z-IFP-01]'),
  (8,  'corporate',  'referral',        'DSS', NULL, NULL, NULL, NULL, NULL, 30, 'Dapat nomor dari Pak Hadi, mau signage untuk cabang'),
  (9,  'hotel',      'meta_ctwa',       'LED', 'Z-LED-01', NULL, NULL, NULL, NULL, 6,  'Videowall untuk ballroom hotel, bisa survei? [Z-LED-01]'),
  (10, 'education',  'website_form',    'IFP', NULL, 'google', 'organic', NULL, 'https://fortu.co.id/ifp', 40, 'Minta brosur dan harga IFP 86 untuk kampus'),
  (11, 'education',  'meta_ctwa',       'IFP', 'Z-IFP-01', NULL, NULL, NULL, NULL, 4,  'Halo, sekolah kami mau 6 unit IFP [Z-IFP-01]'),
  (12, 'hospital',   'whatsapp_direct', 'DSS', NULL, NULL, NULL, NULL, NULL, 12, 'Selamat pagi, mau tanya signage untuk lobi RS'),
  (13, 'education',  'walk_in',         'IFP', NULL, NULL, NULL, NULL, NULL, 1,  'Datang ke kantor Fortu, lihat demo IFP'),
  (14, 'automotive', 'meta_ctwa',       'DSS', 'Z-DSS-01', NULL, NULL, NULL, NULL, 9,  'Signage untuk showroom mobil, ada standing? [Z-DSS-01]'),
  (15, 'government', 'tender',          'IFP', NULL, NULL, NULL, NULL, NULL, 72, 'Undangan tender pengadaan IFP Dinas Pendidikan'),
  (16, 'corporate',  'whatsapp_direct', 'IFP', NULL, NULL, NULL, NULL, NULL, 7,  'Mau IFP 75 plus OPS untuk ruang meeting'),
  (17, 'retail_fnb', 'meta_ctwa',       'LED', 'Z-LED-01', NULL, NULL, NULL, NULL, 18, 'LED atrium mal ukuran 5x3 meter [Z-LED-01]'),
  (18, 'education',  'event',           'IFP', NULL, NULL, NULL, NULL, NULL, 96, 'Dari seminar guru di Bandung, minta demo IFP'),
  (19, 'education',  'meta_ctwa',       'IFP', 'Z-IFP-02', NULL, NULL, NULL, NULL, 10, 'Info IFP untuk SMA negeri, bisa e-katalog? [Z-IFP-02]'),
  (20, 'retail_fnb', 'website_wa_link', 'DSS', NULL, 'facebook', 'paid', 'resto-signage', 'https://fortu.co.id/digital-signage/fnb', 3, 'Halo, mau signage menu untuk resto'),
  (21, 'education',  'referral',        'IFP', NULL, NULL, NULL, NULL, NULL, 48, 'Rekomendasi dari SMA Negeri 3, mau IFP juga'),
  (22, 'corporate',  'website_form',    'LED', NULL, 'linkedin', 'social', 'led-korporat', 'https://fortu.co.id/led-videowall', 24, 'LED untuk lobi kantor pusat'),
  (23, 'education',  'meta_ctwa',       'IFP', 'Z-IFP-01', NULL, NULL, NULL, NULL, 2,  'IFP 75 untuk TK, ada cicilan? [Z-IFP-01]'),
  (24, 'government', 'whatsapp_direct', 'DSS', NULL, NULL, NULL, NULL, NULL, 15, 'Signage antrian untuk bank daerah'),
  (25, 'media',      'meta_ctwa',       'LED', 'Z-LED-01', NULL, NULL, NULL, NULL, 4,  'Videowall untuk studio podcast [Z-LED-01]');

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
  x demo_sources%ROWTYPE;
  v_rep uuid; v_company uuid; v_contact uuid; v_deal uuid; v_lead uuid; v_event bigint; v_at timestamptz;
  reps uuid[];
BEGIN
  SELECT array_agg(id ORDER BY n) INTO reps
    FROM (VALUES (1, 'rina'), (2, 'bagas'), (3, 'sari'), (4, 'tono')) AS m(n, who)
    JOIN users u ON u.email = m.who || '@demo.fortu.invalid';

  FOR r IN SELECT * FROM demo_deals ORDER BY n LOOP
    v_rep := reps[r.rep];
    PERFORM set_config('app.user_id', v_rep::text, true);

    SELECT * INTO x FROM demo_sources WHERE n = r.n;
    -- the first chat, a little before the deal was made (age_days is set on the deal further down)
    v_at := now() - make_interval(days => r.age_days, hours => x.lag_hours);

    INSERT INTO companies (name, industry, city, owner_user_id, is_sample, created_at)
    VALUES (r.company, x.industry, (ARRAY['Jakarta','Bandung','Surabaya','Medan','Semarang'])[1 + r.n % 5], v_rep, true, v_at)
    RETURNING id INTO v_company;

    INSERT INTO contacts (phone_e164, full_name, job_title, company_id, owner_user_id, is_sample, created_at)
    VALUES ('+628880000' || lpad(r.n::text, 3, '0'), r.contact, 'Pengambil keputusan', v_company, v_rep, true, v_at)
    RETURNING id INTO v_contact;

    -- the lead behind the deal: a web form keeps its page in the inbound event, the WA button its click
    v_event := NULL;
    IF x.channel = 'website_form' THEN
      INSERT INTO inbound_events (provider, external_id, payload, received_at, processed_at)
      VALUES ('web_form', 'demo-' || r.n,
              jsonb_build_object('name', r.contact, 'message', x.msg, 'page_url', x.page,
                                 'utm', jsonb_strip_nulls(jsonb_build_object('source', x.utm_source, 'medium', x.utm_medium, 'campaign', x.utm_campaign))),
              v_at, v_at)
      RETURNING id INTO v_event;
    END IF;
    INSERT INTO leads (contact_id, owner_user_id, source_channel, capture_method, product_interest, ad_id,
                       utm_source, utm_medium, utm_campaign, first_message, inbound_event_id,
                       received_at, logged_at, first_response_at, status, is_sample)
    VALUES (v_contact, v_rep, x.channel::source_channel,
            (CASE x.channel WHEN 'website_form' THEN 'web_form' WHEN 'website_wa_link' THEN 'wa_link_ref' ELSE 'manual_quick_add' END)::capture_method,
            x.line::product_line, (SELECT id FROM ads WHERE prefill_code = x.ad_code),
            x.utm_source, x.utm_medium, x.utm_campaign, x.msg, v_event,
            v_at, v_at + make_interval(mins => 2 + r.n % 7), v_at + make_interval(mins => 5 + (r.n * 11) % 50), 'converted', true)
    RETURNING id INTO v_lead;
    UPDATE contacts SET first_lead_id = v_lead WHERE id = v_contact;
    IF x.channel = 'website_wa_link' THEN
      INSERT INTO wa_click_events (ref_code, source_channel, utm_source, utm_medium, utm_campaign, landing_url,
                                   target_user_id, clicked_at, matched_lead_id)
      VALUES ('demo-' || r.n, 'website_wa_link', x.utm_source, x.utm_medium, x.utm_campaign, x.page, v_rep,
              v_at - interval '2 minutes', v_lead);
    END IF;

    -- every deal starts in Chat; products and the close date come before the move, as the stage rules want
    INSERT INTO deals (name, contact_id, company_id, owner_user_id, lead_id, stage_id, est_amount, next_step, next_step_date,
                       demo_date, is_sample)
    SELECT r.name, v_contact, v_company, v_rep, v_lead, s.id, r.est,
           COALESCE(r.step, 'Telepon'), jakarta_today() + COALESCE(r.step_off, 0),
           CASE WHEN r.stage IN ('negotiation', 'po', 'done') THEN jakarta_today() - 10 END, true
      FROM pipeline_stages s WHERE s.key = 'chat'
    RETURNING id INTO v_deal;
    UPDATE leads SET deal_id = v_deal WHERE id = v_lead;

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

-- ───────── Last chats ─────────
-- A chat when the deal was last touched (most deals), an earlier call on the older ones, and nothing new on two
-- open deals, so Kontak shows a realistic spread and a few contacts that need a follow-up.
INSERT INTO activities (type, contact_id, deal_id, user_id, body, created_at)
SELECT 'whatsapp', d.contact_id, d.id, d.owner_user_id, 'Chat WhatsApp: ' || COALESCE(d.next_step, 'kabar terakhir'),
       COALESCE(d.closed_at, d.updated_at) - make_interval(hours => 1 + x.n % 5)
  FROM deals d
  JOIN demo_deals x ON d.contact_id = (SELECT id FROM contacts WHERE phone_e164 = '+628880000' || lpad(x.n::text, 3, '0'))
 WHERE d.is_sample AND x.n NOT IN (10, 14);
INSERT INTO activities (type, contact_id, deal_id, user_id, body, created_at)
SELECT 'call', d.contact_id, d.id, d.owner_user_id, 'Telepon: bahas kebutuhan dan anggaran',
       d.created_at + (COALESCE(d.closed_at, now()) - d.created_at) / 2
  FROM deals d
 WHERE d.is_sample AND d.created_at < now() - interval '20 days';

-- ───────── Prospek: chats that are not a deal yet ─────────
-- Direct inserts are fine here: this is sample data, not a lead coming in (real ones go through ingestLead()).
-- From a few minutes to ten days old, from every source group, some answered and one that was not a buyer.
WITH reps AS (
  SELECT id, row_number() OVER (ORDER BY email) AS i FROM users WHERE email LIKE '%@demo.fortu.invalid'
), seed (n, name, msg, channel, line, ad_code, utm_source, utm_medium, utm_campaign, page, status, ago_min) AS (VALUES
  (1,  'Pak Irfan Maulana',  'Halo kak, mau tanya harga IFP 65 inch untuk 3 kelas [Z-IFP-01]', 'meta_ctwa', 'IFP', 'Z-IFP-01', NULL, NULL, NULL, NULL, 'new', 25),
  (2,  'Ibu Tika Anggraeni', 'Selamat siang, ada signage standing untuk lobi kantor?', 'website_form', 'DSS', NULL, 'google', 'cpc', 'signage-kantor', 'https://fortu.co.id/digital-signage', 'new', 200),
  (3,  'Pak Roni Hakim',     'Tanya videowall LED ukuran 3x2 meter, berapa kisarannya? [Z-LED-01]', 'meta_ctwa', 'LED', 'Z-LED-01', NULL, NULL, NULL, NULL, 'contacted', 600),
  (4,  'Mbak Putri Ayu',     'Kak, bisa demo IFP di sekolah kami minggu depan?', 'referral', 'IFP', NULL, NULL, NULL, NULL, NULL, 'contacted', 1500),
  (5,  'Pak Gunawan',        'Mau beli 10 unit signage untuk cabang, minta penawaran', 'whatsapp_direct', 'DSS', NULL, NULL, NULL, NULL, NULL, 'new', 60),
  (6,  'Ibu Hesti Rahma',    'Info harga IFP 86 inch dan garansinya ya', 'instagram_dm', 'IFP', NULL, NULL, NULL, NULL, NULL, 'contacted', 2900),
  (7,  'Pak Yusuf Hamdani',  'Signage untuk 3 cabang minimarket [Z-DSS-01]', 'meta_ctwa', 'DSS', 'Z-DSS-01', NULL, NULL, NULL, NULL, 'new', 8),
  (8,  'Ibu Melati Sari',    'Halo, mau info IFP untuk ruang guru', 'website_wa_link', 'IFP', NULL, 'instagram', 'social', 'guru-2026', 'https://fortu.co.id/ifp/pendidikan', 'contacted', 4300),
  (9,  'Pak Darto',          'Ketemu di booth pameran pendidikan, minta katalog', 'event', 'IFP', NULL, NULL, NULL, NULL, NULL, 'contacted', 8600),
  (10, 'Nomor tidak dikenal', 'Promo pinjaman cepat, klik link ini', 'whatsapp_direct', NULL, NULL, NULL, NULL, NULL, NULL, 'disqualified', 14000)
), c AS (
  INSERT INTO contacts (phone_e164, full_name, owner_user_id, is_sample, created_at)
  SELECT '+628881000' || lpad(s.n::text, 3, '0'), s.name, r.id, true, now() - make_interval(mins => s.ago_min)
    FROM seed s JOIN reps r ON r.i = 1 + (s.n % 4)
  RETURNING id, phone_e164, owner_user_id
), ev AS (
  INSERT INTO inbound_events (provider, external_id, payload, received_at, processed_at)
  SELECT 'web_form', 'demo-p' || s.n,
         jsonb_build_object('name', s.name, 'message', s.msg, 'page_url', s.page,
                            'utm', jsonb_build_object('source', s.utm_source, 'medium', s.utm_medium, 'campaign', s.utm_campaign)),
         now() - make_interval(mins => s.ago_min), now() - make_interval(mins => s.ago_min)
    FROM seed s WHERE s.channel = 'website_form'
  RETURNING id, external_id
), l AS (
  INSERT INTO leads (contact_id, owner_user_id, source_channel, capture_method, product_interest, ad_id,
                     utm_source, utm_medium, utm_campaign, first_message, inbound_event_id,
                     received_at, logged_at, first_response_at, status, disqualify_reason, is_sample)
  SELECT c.id, c.owner_user_id, s.channel::source_channel,
         (CASE s.channel WHEN 'website_form' THEN 'web_form' WHEN 'website_wa_link' THEN 'wa_link_ref' ELSE 'manual_quick_add' END)::capture_method,
         s.line::product_line, (SELECT id FROM ads WHERE prefill_code = s.ad_code),
         s.utm_source, s.utm_medium, s.utm_campaign, s.msg, ev.id,
         now() - make_interval(mins => s.ago_min), now() - make_interval(mins => GREATEST(s.ago_min - 3, 0)),
         CASE WHEN s.status <> 'new' THEN now() - make_interval(mins => GREATEST(s.ago_min - 20, 0)) END,
         s.status::lead_status, CASE WHEN s.status = 'disqualified' THEN 'not_buyer' END, true
    FROM seed s
    JOIN c ON c.phone_e164 = '+628881000' || lpad(s.n::text, 3, '0')
    LEFT JOIN ev ON ev.external_id = 'demo-p' || s.n
  RETURNING id, contact_id, source_channel, utm_source, utm_medium, utm_campaign, owner_user_id, received_at
)
INSERT INTO wa_click_events (ref_code, source_channel, utm_source, utm_medium, utm_campaign, landing_url, target_user_id, clicked_at, matched_lead_id)
SELECT 'demo-p' || s.n, 'website_wa_link', l.utm_source, l.utm_medium, l.utm_campaign, s.page, l.owner_user_id,
       l.received_at - interval '2 minutes', l.id
  FROM l
  JOIN c ON c.id = l.contact_id  -- rows made in this statement are seen through the CTEs, not the tables
  JOIN seed s ON c.phone_e164 = '+628881000' || lpad(s.n::text, 3, '0')
 WHERE l.source_channel = 'website_wa_link';

UPDATE contacts c SET first_lead_id = l.id
  FROM leads l
 WHERE l.contact_id = c.id AND c.is_sample AND c.first_lead_id IS NULL;
