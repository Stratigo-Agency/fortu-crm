# Review 3 minggu Fortu CRM

> **Contoh dengan data demo. Ini bukan angka asli. Isinya data demo ditambah iklan, target, dan lead tambahan buatan, supaya semua bagian terisi. Periodenya sengaja berbeda dari pilot.**

Periode: 1 Sep 2026 sampai 6 Nov 2026. Dibuat 6 November 2026 pukul 10.09 WIB.
Semua angka Rupiah sebelum PPN. Waktu memakai jam Jakarta (WIB).
**Data contoh (is_sample) ikut dihitung di file ini. Jangan dipakai untuk angka asli.**
Angka dibulatkan: Rupiah ke juta atau miliar, persen dan hari satu desimal.
Setiap angka punya query SQL-nya di Lampiran, di bagian paling bawah.

## Ringkasan

- Lead masuk: 42.
- Waktu dari chat masuk sampai dicatat (median, lead yang dicatat manual): 74 menit.
- Deal selesai: 4 Done deal dan 3 Lost. Win rate 57,1%.
- Nilai Done deal di periode ini: Rp1,03 M.
- Chat iklan yang tercatat di CRM: 40,9% (27 dari 66).
- Target September 2026, Oktober 2026, November 2026: lihat bagian 4.

## 1. Lead masuk

### Per sumber

| Sumber | Lead |
| --- | ---: |
| Iklan Meta / WA | 29 |
| Website | 10 |
| Instagram | 1 |
| Referral | 1 |
| WhatsApp langsung | 1 |
| Semua sumber | 42 |

### Per sales

| Sales | Lead | Jadi deal |
| --- | ---: | ---: |
| Rina Putri (demo) | 11 | 0 |
| Sari Lestari (demo) | 11 | 0 |
| Bagas Pratama (demo) | 10 | 0 |
| Tono Wibowo (demo) | 10 | 0 |
| Semua sales | 42 | 0 |

### Waktu dari chat masuk sampai dicatat

Hanya lead yang dicatat manual oleh sales (Tambah cepat). Lead dari form website, tombol WA, dan sistem dicatat otomatis dalam hitungan detik, jadi tidak dihitung di sini. Jam chat masuk diisi sales, jadi angka ini menunjukkan seberapa cepat chat dicatat.

| Sales | Lead | Median | 9 dari 10 lead dalam | Lebih dari 60 menit |
| --- | ---: | ---: | ---: | ---: |
| Rina Putri (demo) | 11 | 75 menit | 2,8 jam | 7 |
| Sari Lestari (demo) | 11 | 74 menit | 2,3 jam | 6 |
| Tono Wibowo (demo) | 10 | 80 menit | 2,3 jam | 6 |
| Bagas Pratama (demo) | 1 | 0 menit | 0 menit | 0 |
| Semua sales | 33 | 74 menit | 2,5 jam | 19 |

## 2. Pipeline

### Konversi dan lama di tiap tahap

Dihitung dari semua deal sejak CRM dipakai, bukan hanya periode ini. Tiap deal dihitung sekali per tahap. Tiap deal yang pernah masuk tahap berakhir di satu kolom: lanjut ke tahap berikutnya, Lost di sini, kembali ke tahap sebelumnya, atau masih di sini. "Lanjut (%)" = lanjut dibagi deal yang sudah meninggalkan tahap itu.

| Tahap | Pernah masuk | Lanjut | Lost di sini | Kembali mundur | Masih di sini | Lanjut (%) | Lama di tahap (median) | 3 dari 4 deal pindah dalam |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Chat masuk | 25 | 16 | 3 | 0 | 6 | 84,2% | 24 hari | 32,5 hari |
| Quotation | 6 | 0 | 0 | 0 | 6 | - | - | - |
| Negotiation | 4 | 0 | 0 | 0 | 4 | - | - | - |
| PO | 2 | 0 | 0 | 0 | 2 | - | - | - |

### Win rate

Dari deal yang selesai (Done deal atau Lost) di periode ini, berdasarkan tanggal selesai. "(sedikit data)" = kurang dari 10 deal selesai.

| Sales | Done deal | Lost | Win rate | Nilai Done deal |
| --- | ---: | ---: | ---: | ---: |
| Bagas Pratama (demo) | 1 | 1 | 50% (1 dari 2) (sedikit data) | Rp84 jt |
| Rina Putri (demo) | 1 | 1 | 50% (1 dari 2) (sedikit data) | Rp264 jt |
| Sari Lestari (demo) | 1 | 1 | 50% (1 dari 2) (sedikit data) | Rp492 jt |
| Tono Wibowo (demo) | 1 | 0 | 100% (1 dari 1) (sedikit data) | Rp192 jt |
| Semua sales | 4 | 3 | 57,1% (4 dari 7) (sedikit data) | Rp1,03 M |

### Alasan lost

| Alasan | Deal | Nilai | Bagian |
| --- | ---: | ---: | ---: |
| Harga terlalu tinggi | 1 | Rp135 jt | 33,3% |
| Pilih kompetitor | 1 | Rp168 jt | 33,3% |
| Waktunya belum tepat | 1 | Rp60 jt | 33,3% |

### Diskon

Dua hitungan di bawah memakai tanggal yang berbeda.

- Menurut tanggal persetujuan: 1 deal disetujui diskonnya di periode ini (daftar di bawah).
- Menurut tanggal deal dibuat: 1 dari 23 deal yang dibuat di periode ini punya diskon di atas batas. Deal itu belum tentu sudah disetujui, atau disetujui di periode lain.
- Menunggu persetujuan sekarang: 0 deal.

| Deal | Sales | Tahap | Nilai | Diskon terbesar | Batas | Disetujui oleh | Tanggal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IFP 75 SD Pelita | Rina Putri (demo) | Quotation | Rp216 jt | 20% | 15% | - | 1 Nov 2026 |

## 3. Iklan ke CRM

Chat iklan menurut Meta dibandingkan dengan lead di CRM dari sumber iklan Meta / WA yang tercatat dengan iklannya (kode iklan). Angkanya tidak dibatasi 100%: kalau lebih dari 100%, hitungan Meta dan CRM belum sama.

| Chat iklan (Meta) | Lead iklan Meta dengan kode di CRM | Tercatat | Lead iklan Meta tanpa kode |
| --- | ---: | ---: | ---: |
| 66 | 27 | 40,9% | 2 |

Iklan yang paling banyak belum tercatat:

| Iklan | Kode | Chat (Meta) | Lead di CRM | Belum tercatat |
| --- | ---: | ---: | ---: | ---: |
| Iklan 1 (demo) | D-IFP-01 | 22 | 9 | 13 |
| Iklan 2 (demo) | D-IFP-02 | 22 | 9 | 13 |
| Iklan 3 (demo) | D-IFP-03 | 22 | 9 | 13 |

## 4. Target dan hasil

Bulan penuh dihitung utuh. Bulan yang hanya sebagian di dalam periode ditandai "(sebagian)": hanya Done deal dengan tanggal selesai di periode yang dihitung, dibandingkan dengan target sebulan penuh, dan tidak dipakai untuk usulan. Unit = layar yang masuk hitungan target.

| Bulan | Siapa | Target unit | Unit tercapai | Unit (%) | Target Rupiah | Rupiah tercapai | Rupiah (%) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| September 2026 | Perusahaan | 40 | 42 | 105% | Rp600 jt | Rp684 jt | 114% |
| Oktober 2026 | Perusahaan | 50 | 2 | 4% | Rp700 jt | Rp84 jt | 12% |
| November 2026 (sebagian) | Perusahaan | 60 | 6 | 10% | Rp800 jt | Rp264 jt | 33% |

## 5. Usulan perubahan

**Ini usulan saja. Belum ada yang diubah di CRM.** Kita putuskan bersama di review.

Usulan hanya muncul kalau datanya cukup: minimal 10 deal (atau lead) untuk tiap hitungan, 20 deal selesai untuk peluang tahap, 20 chat iklan untuk iklan, dan 5 deal terbuka untuk batas hari. Kalau kurang, tertulis "Data belum cukup".

| Bagian | Sekarang | Usulan | Angka pendukung |
| --- | --- | --- | --- |
| Peluang tahap Chat masuk | 10% | Data belum cukup | Baru 7 deal yang sudah selesai (Done deal atau Lost) dan pernah lewat tahap ini, perlu minimal 20. |
| Peluang tahap Quotation | 30% | Data belum cukup | Baru 0 deal yang sudah selesai (Done deal atau Lost) dan pernah lewat tahap ini, perlu minimal 20. |
| Peluang tahap Negotiation | 60% | Data belum cukup | Baru 0 deal yang sudah selesai (Done deal atau Lost) dan pernah lewat tahap ini, perlu minimal 20. |
| Peluang tahap PO | 90% | Data belum cukup | Baru 0 deal yang sudah selesai (Done deal atau Lost) dan pernah lewat tahap ini, perlu minimal 20. |
| Batas hari belum bergerak, tahap Chat masuk | 2 hari | Pertimbangkan 33 hari | 1 dari 6 deal terbuka (16,7%) sudah lewat batas; 3 dari 4 deal pindah dalam 32,5 hari dan 9 dari 10 dalam 39,4 hari (19 deal yang sudah pindah). |
| Batas hari belum bergerak, tahap Quotation | 5 hari | Tidak perlu diubah | 1 dari 6 deal terbuka (16,7%) lewat batas. |
| Batas hari belum bergerak, tahap Negotiation | 7 hari | Data belum cukup | Baru 4 deal terbuka di tahap ini, perlu minimal 5. |
| Batas hari belum bergerak, tahap PO | 14 hari | Data belum cukup | Baru 2 deal terbuka di tahap ini, perlu minimal 5. |
| Target Rupiah, September 2026 | Rp600 jt | Tidak perlu diubah | Tercapai Rp684 jt dari target Rp600 jt (114%). |
| Target unit layar, September 2026 | 40 | Tidak perlu diubah | Tercapai 42 dari target 40 (105%). |
| Target Rupiah, Oktober 2026 | Rp700 jt | Bahas apakah target terlalu tinggi | Tercapai Rp84 jt dari target Rp700 jt (12%). |
| Target unit layar, Oktober 2026 | 50 | Bahas apakah target terlalu tinggi | Tercapai 2 dari target 50 (4%). |
| Batas diskon | 15% | Tidak perlu diubah | 1 dari 23 deal yang dibuat di periode ini (4,3%) punya diskon di atas batas. Terpisah: 1 deal disetujui diskonnya di periode ini (menurut tanggal persetujuan). |
| Aturan catat chat | - | Bahas batas catat, misalnya 60 menit sejak chat masuk | Median 74 menit dari chat masuk sampai dicatat (33 lead yang dicatat manual); 19 lead lebih dari 60 menit. |
| Aturan kode iklan di chat | - | Pastikan semua iklan memakai kode, dan sales mencatat kode itu | 27 dari 66 chat iklan tercatat dengan iklannya (40,9%); 2 lead iklan tanpa kode. |
| Tindak lanjut alasan lost | - | Data belum cukup | Baru 3 deal Lost di periode ini, perlu minimal 10. |

Batas yang dipakai untuk memunculkan usulan:
- Peluang tahap: hasil nyata berbeda 15 poin atau lebih dari peluang sekarang.
- Batas hari belum bergerak: 50% atau lebih deal terbuka sudah lewat batas, atau 3 dari 4 deal yang sudah pindah butuh lebih lama dari batas (persentil ke-75, bukan median).
- Target: hanya bulan yang penuh di dalam periode; tercapai kurang dari 50% atau lebih dari 120%.
- Diskon: 30% atau lebih deal baru di atas batas diskon.
- Catat chat (lead dicatat manual): median lebih dari 60 menit. Kode iklan: kurang dari 70% tercatat.
- Alasan lost: satu alasan 40% atau lebih dari deal Lost.

## Lampiran: SQL untuk setiap angka

Buka satu per satu. Query ini hanya membaca data (SELECT).

<details>
<summary>Lead masuk per sumber (leads_by_source)</summary>

Parameter: $1 = 2026-09-01, $2 = 2026-11-06, $3 = true (ikutkan data contoh)

```sql
SELECT l.source_channel::text AS source,
       (GROUPING(l.source_channel) = 1) AS is_total,
       count(*)::int AS leads
  FROM leads l
 WHERE (l.received_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date AND (NOT l.is_sample OR $3::boolean)
 GROUP BY GROUPING SETS ((l.source_channel), ())
 ORDER BY is_total, leads DESC, source
```

</details>

<details>
<summary>Lead masuk per sales (leads_by_rep)</summary>

Parameter: $1 = 2026-09-01, $2 = 2026-11-06, $3 = true (ikutkan data contoh)

```sql
SELECT u.full_name AS rep,
       (GROUPING(l.owner_user_id) = 1) AS is_total,
       count(*)::int AS leads,
       count(l.deal_id)::int AS became_deal
  FROM leads l
  LEFT JOIN users u ON u.id = l.owner_user_id
 WHERE (l.received_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date AND (NOT l.is_sample OR $3::boolean)
 GROUP BY GROUPING SETS ((l.owner_user_id, u.full_name), ())
 ORDER BY is_total, leads DESC, rep
```

</details>

<details>
<summary>Waktu dari chat masuk sampai dicatat di CRM (hanya yang dicatat manual) (time_to_log)</summary>

Parameter: $1 = 2026-09-01, $2 = 2026-11-06, $3 = true (ikutkan data contoh)

```sql
SELECT u.full_name AS rep,
       (GROUPING(l.owner_user_id) = 1) AS is_total,
       count(*)::int AS leads,
       ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM l.logged_at - l.received_at) / 60))::numeric, 1) AS median_min,
       ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM l.logged_at - l.received_at) / 60))::numeric, 1) AS p90_min,
       count(*) FILTER (WHERE l.logged_at - l.received_at > interval '60 minutes')::int AS over_60min
  FROM leads l
  LEFT JOIN users u ON u.id = l.owner_user_id
 WHERE (l.received_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date AND (NOT l.is_sample OR $3::boolean)
   AND l.capture_method = 'manual_quick_add'
 GROUP BY GROUPING SETS ((l.owner_user_id, u.full_name), ())
 ORDER BY is_total, leads DESC, rep
```

</details>

<details>
<summary>Konversi dan lama di tiap tahap (semua deal sejak awal, tanpa data contoh) (stage_conversion)</summary>

Parameter: $1 = true (ikutkan data contoh)

```sql
WITH moves AS (
  SELECT h.deal_id, h.to_stage_id, h.changed_at,
         LEAD(h.changed_at)   OVER w AS left_at,
         LEAD(h.to_stage_id)  OVER w AS next_stage_id
    FROM deal_stage_history h
    JOIN deals d ON d.id = h.deal_id
   WHERE (NOT d.is_sample OR $1::boolean)
  WINDOW w AS (PARTITION BY h.deal_id ORDER BY h.changed_at, h.id)
), visits AS (
  SELECT s.id AS stage_id, m.deal_id, m.changed_at, m.left_at,
         (ns.id IS NOT NULL AND NOT ns.is_lost AND ns.position > s.position) AS went_on,
         COALESCE(ns.is_lost, false) AS went_lost,
         (ns.id IS NOT NULL AND NOT ns.is_lost AND ns.position <= s.position) AS went_back,
         (ns.id IS NULL) AS is_current
    FROM moves m
    JOIN pipeline_stages s ON s.id = m.to_stage_id AND NOT s.is_won AND NOT s.is_lost
    LEFT JOIN pipeline_stages ns ON ns.id = m.next_stage_id
), per_deal AS (
  SELECT stage_id, deal_id,
         bool_or(went_on) AS went_on, bool_or(went_lost) AS went_lost,
         bool_or(is_current) AS is_current, bool_or(went_back) AS went_back
    FROM visits
   GROUP BY stage_id, deal_id
), outcome AS (
  SELECT stage_id,
         count(*)::int AS entered,
         count(*) FILTER (WHERE NOT is_current AND went_on)::int AS moved_on,
         count(*) FILTER (WHERE NOT is_current AND NOT went_on AND went_lost)::int AS lost_here,
         count(*) FILTER (WHERE is_current)::int AS still_here,
         count(*) FILTER (WHERE NOT is_current AND NOT went_on AND NOT went_lost)::int AS moved_back
    FROM per_deal
   GROUP BY stage_id
), timing AS (
  SELECT stage_id,
         count(*)::int AS finished_visits,
         ROUND((percentile_cont(0.5)  WITHIN GROUP (ORDER BY extract(epoch FROM left_at - changed_at) / 86400))::numeric, 1) AS median_days_in_stage,
         ROUND((percentile_cont(0.75) WITHIN GROUP (ORDER BY extract(epoch FROM left_at - changed_at) / 86400))::numeric, 1) AS p75_days_in_stage,
         ROUND((percentile_cont(0.9)  WITHIN GROUP (ORDER BY extract(epoch FROM left_at - changed_at) / 86400))::numeric, 1) AS p90_days_in_stage
    FROM visits
   WHERE left_at IS NOT NULL
   GROUP BY stage_id
)
SELECT s.key, s.name, s.position,
       COALESCE(o.entered, 0) AS entered,
       COALESCE(o.moved_on, 0) AS moved_on,
       COALESCE(o.lost_here, 0) AS lost_here,
       COALESCE(o.moved_back, 0) AS moved_back,
       COALESCE(o.still_here, 0) AS still_here,
       CASE WHEN COALESCE(o.moved_on, 0) + COALESCE(o.lost_here, 0) + COALESCE(o.moved_back, 0) > 0
            THEN ROUND(o.moved_on * 100.0 / (o.moved_on + o.lost_here + o.moved_back), 1) END AS moved_on_pct,
       COALESCE(t.finished_visits, 0) AS finished_visits,
       t.median_days_in_stage, t.p75_days_in_stage, t.p90_days_in_stage
  FROM pipeline_stages s
  LEFT JOIN outcome o ON o.stage_id = s.id
  LEFT JOIN timing t ON t.stage_id = s.id
 WHERE NOT s.is_won AND NOT s.is_lost
 ORDER BY s.position
```

</details>

<details>
<summary>Win rate (deal yang selesai di periode ini) (win_rate)</summary>

Parameter: $1 = 2026-09-01, $2 = 2026-11-06, $3 = true (ikutkan data contoh)

```sql
SELECT u.full_name AS rep,
       (GROUPING(d.owner_user_id) = 1) AS is_total,
       count(*) FILTER (WHERE d.is_won)::int AS won,
       count(*) FILTER (WHERE d.is_lost)::int AS lost,
       count(*)::int AS closed,
       ROUND(count(*) FILTER (WHERE d.is_won) * 100.0 / NULLIF(count(*), 0), 1) AS win_rate_pct,
       COALESCE(sum(d.amount) FILTER (WHERE d.is_won), 0) AS won_amount
  FROM v_deals_enriched d
  JOIN deals sd ON sd.id = d.id
  LEFT JOIN users u ON u.id = d.owner_user_id
 WHERE (d.is_won OR d.is_lost) AND d.closed_on BETWEEN $1::date AND $2::date
   AND (NOT sd.is_sample OR $3::boolean)
 GROUP BY GROUPING SETS ((d.owner_user_id, u.full_name), ())
 ORDER BY is_total, won DESC, rep
```

</details>

<details>
<summary>Alasan lost (lost_reasons)</summary>

Parameter: $1 = 2026-09-01, $2 = 2026-11-06, $3 = true (ikutkan data contoh)

```sql
SELECT d.lost_reason::text AS reason,
       count(*)::int AS deals,
       COALESCE(sum(d.amount), 0) AS amount,
       ROUND(count(*) * 100.0 / sum(count(*)) OVER (), 1) AS share_pct
  FROM v_deals_enriched d
  JOIN deals sd ON sd.id = d.id
 WHERE d.is_lost AND d.closed_on BETWEEN $1::date AND $2::date
   AND (NOT sd.is_sample OR $3::boolean)
 GROUP BY d.lost_reason
 ORDER BY deals DESC, reason
```

</details>

<details>
<summary>Diskon: ringkasan (discount_summary)</summary>

Parameter: $1 = 2026-09-01, $2 = 2026-11-06, $3 = true (ikutkan data contoh)

```sql
SELECT count(*) FILTER (WHERE (d.discount_approved_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date)::int AS approved,
       count(*) FILTER (WHERE d.needs_discount_approval AND NOT d.is_lost)::int AS waiting_now,
       count(*) FILTER (WHERE (d.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date
                          AND EXISTS (SELECT 1 FROM v_deal_line_discounts x WHERE x.deal_id = d.id AND x.over_limit))::int AS over_limit_deals,
       count(*) FILTER (WHERE (d.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date)::int AS deals_created
  FROM v_deals_enriched d
  JOIN deals sd ON sd.id = d.id
 WHERE (NOT sd.is_sample OR $3::boolean)
```

</details>

<details>
<summary>Deal dengan diskon yang disetujui (menurut tanggal persetujuan) (discounts_approved)</summary>

Parameter: $1 = 2026-09-01, $2 = 2026-11-06, $3 = true (ikutkan data contoh)

```sql
SELECT d.name AS deal,
       u.full_name AS rep,
       d.stage_name,
       d.amount,
       (SELECT max(x.discount_pct_vs_msrp) FROM v_deal_line_discounts x WHERE x.deal_id = d.id) AS max_discount_pct,
       (SELECT max(x.max_discount_pct) FROM v_deal_line_discounts x WHERE x.deal_id = d.id) AS limit_pct,
       a.full_name AS approved_by,
       (d.discount_approved_at AT TIME ZONE 'Asia/Jakarta')::date::text AS approved_on
  FROM v_deals_enriched d
  JOIN deals sd ON sd.id = d.id
  LEFT JOIN users u ON u.id = d.owner_user_id
  LEFT JOIN users a ON a.id = d.discount_approved_by
 WHERE (d.discount_approved_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date
   AND (NOT sd.is_sample OR $3::boolean)
 ORDER BY d.discount_approved_at, d.name
```

</details>

<details>
<summary>Iklan ke CRM: berapa chat iklan yang tercatat (ads_capture)</summary>

Parameter: $1 = 2026-09-01, $2 = 2026-11-06, $3 = true (ikutkan data contoh)

```sql
WITH meta AS (
  SELECT COALESCE(sum(meta_conversations), 0)::int AS meta_chats
    FROM ad_insights_daily
   WHERE date BETWEEN $1::date AND $2::date
), crm AS (
  SELECT count(*) FILTER (WHERE l.ad_id IS NOT NULL)::int AS leads_with_ad,
         count(*)::int AS ctwa_leads,
         count(*) FILTER (WHERE l.ad_id IS NULL)::int AS ctwa_without_ad
    FROM leads l
   WHERE (l.received_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date AND (NOT l.is_sample OR $3::boolean)
     AND l.source_channel = 'meta_ctwa'
)
SELECT meta.meta_chats, crm.leads_with_ad, crm.ctwa_leads, crm.ctwa_without_ad,
       CASE WHEN meta.meta_chats > 0
            THEN ROUND(crm.leads_with_ad * 100.0 / meta.meta_chats, 1) END AS capture_pct,
       (meta.meta_chats > 0 AND crm.leads_with_ad > meta.meta_chats) AS over_100
  FROM meta, crm
```

</details>

<details>
<summary>Iklan ke CRM per iklan (10 yang paling banyak belum tercatat) (ads_capture_by_ad)</summary>

Parameter: $1 = 2026-09-01, $2 = 2026-11-06, $3 = true (ikutkan data contoh)

```sql
SELECT a.name AS ad_name,
       a.prefill_code AS ad_code,
       COALESCE(i.chats, 0)::int AS meta_chats,
       COALESCE(l.leads, 0)::int AS leads_with_ad,
       GREATEST(COALESCE(i.chats, 0) - COALESCE(l.leads, 0), 0)::int AS missing
  FROM ads a
  LEFT JOIN (SELECT ad_id, sum(meta_conversations) AS chats
               FROM ad_insights_daily
              WHERE date BETWEEN $1::date AND $2::date
              GROUP BY ad_id) i ON i.ad_id = a.id
  LEFT JOIN (SELECT l.ad_id, count(*) AS leads
               FROM leads l
              WHERE l.ad_id IS NOT NULL AND l.source_channel = 'meta_ctwa'
                AND (l.received_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date AND (NOT l.is_sample OR $3::boolean)
              GROUP BY l.ad_id) l ON l.ad_id = a.id
 WHERE i.ad_id IS NOT NULL OR l.ad_id IS NOT NULL
 ORDER BY missing DESC, ad_name
 LIMIT 10
```

</details>

<details>
<summary>Target unit dan Rupiah per bulan (bulan penuh di dalam periode) (targets)</summary>

Parameter: $1 = 2026-09-01, $2 = 2026-11-06, $3 = true (ikutkan data contoh)

```sql
SELECT t.period_month::text AS month,
       u.full_name AS rep,
       (t.user_id IS NULL) AS is_company,
       (t.period_month >= $1::date
        AND (t.period_month + interval '1 month' - interval '1 day')::date <= $2::date) AS full_month,
       t.target_units,
       won.units::int AS units_won,
       CASE WHEN t.target_units > 0 THEN ROUND(won.units * 100.0 / t.target_units, 1) END AS units_pct,
       t.target_amount,
       won.amount AS amount_won,
       CASE WHEN t.target_amount > 0 THEN ROUND(won.amount * 100.0 / t.target_amount, 1) END AS amount_pct
  FROM sales_targets t
  LEFT JOIN users u ON u.id = t.user_id
  CROSS JOIN LATERAL (
    SELECT COALESCE((SELECT sum(d.amount)
                       FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id AND s.is_won
                      WHERE date_trunc('month', d.closed_on)::date = t.period_month
                        AND d.closed_on BETWEEN $1::date AND $2::date
                        AND (t.user_id IS NULL OR d.owner_user_id = t.user_id)
                        AND (NOT d.is_sample OR $3::boolean)), 0) AS amount,
           COALESCE((SELECT sum(li.qty)
                       FROM deals d
                       JOIN pipeline_stages s ON s.id = d.stage_id AND s.is_won
                       JOIN deal_line_items li ON li.deal_id = d.id
                       JOIN products p ON p.id = li.product_id AND p.counts_as_screen
                      WHERE date_trunc('month', d.closed_on)::date = t.period_month
                        AND d.closed_on BETWEEN $1::date AND $2::date
                        AND (t.user_id IS NULL OR d.owner_user_id = t.user_id)
                        AND (NOT d.is_sample OR $3::boolean)), 0) AS units
  ) won
 WHERE t.period_month BETWEEN date_trunc('month', $1::date)::date AND date_trunc('month', $2::date)::date
 ORDER BY t.period_month, (t.user_id IS NOT NULL), u.full_name
```

</details>

<details>
<summary>Peluang tahap: hasil akhir deal yang pernah lewat tiap tahap (stage_outcomes)</summary>

Parameter: $1 = true (ikutkan data contoh)

```sql
SELECT s.key, s.name, s.position, s.probability, s.stale_after_days,
       count(DISTINCT d.id)::int AS entered,
       count(DISTINCT d.id) FILTER (WHERE cs.is_won)::int AS later_won,
       count(DISTINCT d.id) FILTER (WHERE cs.is_lost)::int AS later_lost,
       count(DISTINCT d.id) FILTER (WHERE cs.is_won OR cs.is_lost)::int AS closed,
       count(DISTINCT d.id) FILTER (WHERE NOT cs.is_won AND NOT cs.is_lost)::int AS still_open,
       ROUND(count(DISTINCT d.id) FILTER (WHERE cs.is_won) * 100.0
             / NULLIF(count(DISTINCT d.id) FILTER (WHERE cs.is_won OR cs.is_lost), 0), 1) AS win_pct_of_closed
  FROM pipeline_stages s
  LEFT JOIN deal_stage_history h ON h.to_stage_id = s.id
  LEFT JOIN deals d ON d.id = h.deal_id AND (NOT d.is_sample OR $1::boolean)
  LEFT JOIN pipeline_stages cs ON cs.id = d.stage_id
 WHERE NOT s.is_won AND NOT s.is_lost
 GROUP BY s.id, s.key, s.name, s.position, s.probability, s.stale_after_days
 ORDER BY s.position
```

</details>

<details>
<summary>Deal terbuka dan yang sudah lewat batas hari per tahap (stale_by_stage)</summary>

Parameter: $1 = true (ikutkan data contoh)

```sql
SELECT s.key, s.name, s.stale_after_days,
       count(d.id)::int AS open_deals,
       count(d.id) FILTER (WHERE d.is_stale)::int AS stale_deals
  FROM pipeline_stages s
  LEFT JOIN (SELECT e.id, e.stage_id, e.is_stale
               FROM v_deals_enriched e JOIN deals sd ON sd.id = e.id
              WHERE (NOT sd.is_sample OR $1::boolean)) d ON d.stage_id = s.id
 WHERE NOT s.is_won AND NOT s.is_lost
 GROUP BY s.id, s.key, s.name, s.stale_after_days, s.position
 ORDER BY s.position
```

</details>

<details>
<summary>Aturan yang berlaku sekarang (rule_settings)</summary>

Parameter: tanpa parameter

```sql
SELECT key, (value #>> '{}') AS value
  FROM app_settings
 WHERE key IN ('max_discount_pct', 'followup_days', 'project_min_units', 'project_min_amount')
 ORDER BY key
```

</details>
