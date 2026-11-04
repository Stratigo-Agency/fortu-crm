# Fortu CRM · Build plan for Claude Code

Start every session with the prompt in `docs/prompts/Txx.md`.
One task = one branch = one PR. A task is done only when its "Done when" checks pass.
Branch names: use the Linear branch of the item (e.g. `adibwafi/mar-147-...`) so Linear links the PR.
Pilot with the sales team: **Wed 11 Nov 2026**. Screens to match: canvas "Fortu CRM — Phase 3 Screens" v2.

## Linear map
| Linear | Item | Tasks |
| --- | --- | --- |
| MAR-141 | Fondasi aplikasi dan login | T01 T02 T03 |
| MAR-144 | Catat calon pelanggan dengan cepat | T04 T05 T06 T10 |
| MAR-147 | Pipeline dan detail deal | T07 T08 |
| MAR-163 | Kontak dan perusahaan | T09 |
| MAR-151 | Laporan, pengaturan, dan pengingat | T11 T14 T16 |
| MAR-164 | Harga dan diskon | T15 |
| MAR-152 | Uji coba dan peluncuran (11 Nov) | T12 T17 |
| MAR-153 | Iklan Meta: data otomatis dan kode iklan | T13 T18 |
| MAR-158 | Integrasi lanjutan: WhatsApp, Accurate, stok | T19 T20 T21 |
| MAR-162 | Perkuatan dan review bersama Pak Jovian | T22 T23 |

## Local first
Build and test on your laptop; deploy to Railway at T12.
- Postgres locally: `docker run -d --name fortu-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16`, then `DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres`.
- Google sign-in locally: an OAuth client with redirect `http://localhost:3000/api/auth/callback/google`; add the Railway URL as a second redirect at T12.
- Keep `.env.local` out of git. `.env.example` lists every key from CLAUDE.md with empty values.

---

## Week 1 · MVP (Wed 4 – Tue 10 Nov)

### T01 · Scaffold and database (Day 1)
> Create a Next.js App Router project in TypeScript with Tailwind, ESLint and Vitest, `output: 'standalone'`. Add `lib/db.ts` using `postgres` with `DATABASE_URL`. Put 001–004 in `db/migrations/` and `seed_products.sql` in `db/seeds/`. Write `scripts/migrate.mjs`: create `schema_migrations(filename, applied_at)`, apply each unapplied file in name order inside its own transaction, stop on the first error. Add `db:migrate` and `db:seed`. Tailwind theme from the Brand section of CLAUDE.md (colors, radius, font stack, tabular nums utility). Add `railway.json` for `web` (build `npm run build`, start `node .next/standalone/server.js`, pre-deploy `npm run db:migrate`) and `.env.example`.

**Done when**: migrate on an empty local Postgres applies 001–004; seed loads 32 products and can run twice; `/` renders.

### T02 · Google sign-in and roles (Day 1)
> Auth.js v5 with Google. In `signIn` allow only when `profile.email_verified === true` and an active `users` row matches the email (case-insensitive); bind `google_sub` on first sign-in and refuse a different sub later (code in `docs/INTEGRATIONS.md` · Sign-in). Never check `hd`. Session carries `id`, `role`, `full_name`. `lib/authz.ts`: `requireUser()`, `assertCanEditDeal`, `assertCanEditLead`, `assertRole(...roles)`, calling the SQL functions; throw `ForbiddenError` with `t('authz.forbidden')`. Refused sign-in shows `t('authz.notInvited')` on a calm sign-in page with the navy logo. `db/seeds/seed_users.sql` is edited by the admin (no real emails committed).

**Done when**: a registered account signs in, an unregistered one sees the Bahasa message, Vitest covers `assertCanEditDeal` for owner, other rep, sales_lead, ceo.

### T03 · App shell, copy, formatting (Day 1)
> Build the signed-in layout from the canvas: navy top bar with `fortu-logo-white.png` + "CRM", nav Pipeline · Prospek (count badge of new leads) · Kontak · Perusahaan · Laporan · Pengaturan (admin/ceo only), the sales filter select (Semua sales / each rep; stored in a cookie and applied by every list and report), and the user chip. Under 768 px the nav wraps to its own row. `lib/copy.ts`: typed `t(key, vars?)` from `messages/id.json`, throws in dev on a missing key. `lib/format.ts`: `rupiah()` → `Rp540.000.000`, `rupiahShort()` → `Rp540 jt` / `Rp1,12 M`, `relDate()` (hari ini, besok, kemarin, `n hari lalu`, `dalam n hari`), all Asia/Jakarta. `fortu-mark-navy.png` → `app/icon.png`.

**Done when**: every label comes from `t()`, a grep for English UI strings in `app/` finds only the allowed sales words, layout matches the canvas at 1440 px and 390 px.

### T04 · `ingestLead()` (Day 2)
> Implement `lib/ingest/ingestLead.ts` as `docs/INTEGRATIONS.md` · One ingestion function describes: idempotency via `inbound_events`, phone normalisation (`0812…`, `62812…`, `+62 812-…` → `+62812…`), contact upsert, owner resolution (quick-add → the logging rep; otherwise `pick_lead_owner(product_interest)`; write `ownership_changes`), attribution codes (`[X-PPP-NN]` → `ads.prefill_code`, `#XXXX` → `wa_click_events.ref_code`), 24-hour dedupe, then the lead and a `system` activity. One transaction. When the phone already belongs to another rep's contact, return `{ ownerConflict: { contactName, repName } }` so the UI can say so.

**Done when**: Vitest covers phone formats, both code types, dedupe window, idempotent retries, owner resolution and owner conflict, against a real Postgres.

### T05 · Tambah cepat (Day 2)
> `/tambah` from the canvas (phone): WhatsApp number + Tempel (Clipboard API), optional name, first message, product interest chips (IFP · Signage · LED · Belum tahu), Chat masuk (Barusan / Pilih jam). Detect an ad or link code while typing and show "Dari iklan: …" with source and product filled. Server Action → `ingestLead({ captureMethod: 'manual_quick_add' })`. Show `quickAdd.duplicate` when merged. 48 px inputs, 16 px text, one primary button.

**Done when**: on 390 px a lead with `[F-IFP-01]` saves with `ad_id` set in under 15 seconds of typing.

### T06 · Prospek (Day 2)
> `/prospek` from the canvas: three stats, status tabs (Baru · Sudah dihubungi · Semua), search, table (contact + phone, first message, source + code chip, product, received with orange chip after 2 hours, sales, actions). Actions on leads the user can edit: Jadikan deal (T08 dialog), ⋯ → Alihkan / Tidak cocok (reason). Others show the lock + "Hanya lihat".

**Done when**: filters survive reload; a rep cannot reassign another rep's lead even with a forged request; empty state shows `prospek.empty`.

### T07 · Pipeline (Day 3)
> `/pipeline` from the canvas. Five stat tiles from `v_pipeline_summary` (late tile orange only when > 0). Toolbar: search (deal, company, contact, SKU), Board / Ringkas / List, Tampilkan Lost, + Deal. Board with `@dnd-kit/core`: columns from `pipeline_stages` with square stage marker, probability, count and amount; Done deal and Lost show this month only ("n lebih lama ada di Laporan"). Card: name, company, amount + units (or "perkiraan"), tags (Proyek, Diskon di atas batas, n hari tanpa update, Sudah demo), next step line (orange "Terlambat n hari" when overdue), owner, days in stage, lock when not editable. Locked cards don't drag. Drop → `moveDealStage`: `assertCanEditDeal`, `SET LOCAL app.user_id`, UPDATE with the permission in WHERE; on `stage_rule:*` open the deal panel with the stage pre-selected and the missing fields marked; on success a toast "Dipindah ke X" with Batalkan (undo). Ringkas = two-line cards; List = table. Phones: a stage select instead of dragging.

**Done when**: a move writes one history row with `changed_by`; dragging another rep's card is impossible in the UI and refused on the server; moving to Quotation without products opens the panel with "Tambahkan minimal 1 produk…"; undo restores the previous stage.

### T08 · Deal panel and Jadikan deal (Day 3–4)
> Deal opens as a side panel over the board (intercepting route `@panel/(.)deal/[id]`) and as a full page at `/deal/[id]`. Header: name, stage buttons (5 + Lost), value, estimate, days in stage. Sections: Deal (name, company with "Perusahaan baru akan dibuat", sales, contact, WhatsApp + Chat link, source, close date), Produk (SKU select fills MSRP price, unit, price, subtotal; line note "Sesuai MSRP" or "Diskon x% dari MSRP"; total before PPN, screen units; project note when `is_project`), Next step (what, date, demo date), Catatan, Riwayat (stage history + activities). Done deal asks for the payment date; Lost asks for reason + competitor. Unsaved changes guard. `qualifyLead(leadId)` uses the same panel pre-filled from the lead, stage Chat masuk, next step "Follow up WA" in 2 days; sets the lead to converted. `+ Deal` opens it empty; repeat/rental need a parent deal.

**Done when**: a lead becomes a deal in Chat masuk with the right estimate; adding products makes amount = sum of lines; a rep viewing someone else's deal sees the same panel read-only with "Hanya lihat".

### T09 · Kontak and Perusahaan (Day 4)
> `/kontak` from the canvas from `v_contacts_followup`: search, sort (chat terakhir / pertama / nama), "Perlu follow-up (n)" filter, table with orange "lebih dari 14 hari" chip. Contact panel: fields, activity log (Chat WA, Telepon, Demo / meeting, Kunjungan, Email, Catatan; each updates Chat terakhir), and the contact's deals with + Deal. `/perusahaan`: industry list from `messages/id.json`, city, sales, contact count, open deals, pipeline, total done, last chat; company panel with its contacts and deals. One phone number = one contact (show who owns it).

**Done when**: logging an activity updates Chat terakhir; the follow-up filter matches `v_contacts_followup.needs_followup`.

### T10 · Website form and tracked links (Day 4)
> `POST /api/v1/ingest/web-form`: raw body, `X-Fortu-Timestamp` (±300 s), `X-Fortu-Signature` = `sha256=` HMAC of `timestamp.body` with `WEBFORM_HMAC_SECRET`, `timingSafeEqual`, zod, then `ingestLead({ captureMethod: 'web_form', external: { provider: 'web_form', id } })`; 200 for duplicates. `GET /go/wa?line=…&utm_*`: `wa_click_events` row with a 4-char `ref_code`, 302 to `wa.me` with `#code`, rate-limited by IP. FastAPI forwarder from `docs/INTEGRATIONS.md` into `docs/fastapi_forwarder.py`.

**Done when**: a signed request creates a lead; a bad signature returns 401; a replay creates nothing.

### T11 · Laporan (basic) and Pengaturan (Day 5)
> `/laporan` from the canvas, every number from the views: KPI row (Done deal bulan ini vs Rupiah target with bar, Unit layar vs unit target, Perkiraan akhir bulan, Perkiraan pipeline, Win rate 90 hari), Done deal per bulan (6 months, target line), Pipeline per tahap, Perlu perhatian (`v_attention`), Kinerja sales (`v_rep_scorecard`; click a name = sales filter). Reps see their own numbers only. `/pengaturan` (admin/ceo): Target (company Rupiah + units, per rep Rupiah), Aturan (max discount, stale days, follow-up days, project units/amount, high-value reminder), Peluang per tahap, Definisi tahap (editable text shown as tooltip on column headers), Tim sales (invite by email, role, aktif, WhatsApp line), Katalog produk (MSRP, max discount per SKU), Data (export deals and contacts to CSV).

**Done when**: dashboard numbers equal direct SQL on the views for demo data; a sales_rep gets 403 on `/pengaturan`; CSV opens in Excel with Rupiah as plain numbers.

### T12 · QA, deploy, pilot prep (Day 5)
> `db/seeds/demo.sql` (fake data, staging only; rows marked `is_sample` so an admin can delete them). Playwright: quick-add with code → Jadikan deal → add product → drag to Negotiation → next step overdue shows orange → Lost with reason; permission refusal; report renders. Lighthouse on `/tambah` at 390 px. Create the Railway project, add Postgres with backups, deploy `web`, set env, add the Railway URL to Google OAuth. `docs/panduan-sales.md`: one-page Bahasa guide (Tambah cepat, Jadikan deal, geser kartu, next step, Lost).

**Done when**: tests pass on staging; production has real users and no demo data; the guide is ready for the 30-minute briefing on 11 Nov.

---

## Week 2 · Data in (Wed 11 – Tue 17 Nov)
- **T13 · Meta insights sync.** `jobs/insights-sync.ts` as a Railway cron (`0 19 * * *` UTC = 02:00 WIB), re-pulling the last 3 days (`docs/INTEGRATIONS.md` · Meta insights sync); `/pengaturan/iklan` maps campaigns → owners, ad sets → product lines, ads → `prefill_code`. *Done when* `ad_insights_daily` matches Ads Manager for 24–30 Okt.
- **T14 · Laporan lengkap.** Run rate, Perkiraan per bulan close (Lewat / 3 months / Setelahnya / Kosong), Dari iklan ke CRM (`v_ad_leakage_daily`), Permintaan per SKU (`v_sku_demand`), Sumber prospek (`v_sources_90d`), Demo dan alasan lost (`v_demo_effect_90d`, `v_lost_reasons_90d`).
- **T15 · Harga dan diskon.** Load MSRP per SKU (from Pak Jovian), per-SKU max discount, "Setujui diskon" for ceo/admin writing `discount_approved_by/at`, in-app notice to Pak Jovian when a deal needs approval. *Done when* a line at 18% off shows the orange note and the tag, and approval clears both.
- **T16 · Sweeper and reminders.** `jobs/sweeper.ts` hourly 08:00–20:00 WIB: overdue next steps (to the owner), stale deals, deals ≥ `high_value_amount` stuck (to the CEO), deduped per (kind, deal, day); bell + email via Hostinger SMTP.
- **T17 · Pilot fixes.** Two days for what the reps hit in week one.

## Week 3 · Attribution and integrations (Wed 18 – Tue 24 Nov)
- **T18 · Ad codes rollout** (blocked on Nabil). Code per active ad, hand Nabil the prefilled messages, verify the first coded leads.
- **T19 · WhatsApp Coexistence spike.** One test number behind a flag; `/api/v1/webhooks/whatsapp` (verify + signature + `ingestLead`). Go / no-go for the reps' lines.
- **T20 · Accurate read-only spike.** Items and stock into `products` / `inventory_snapshots` nightly; match `sku`.

## Week 4 · Forecast and hardening (Wed 25 Nov – Tue 1 Dec)
- **T21 · Stok & Permintaan** for Operations: per SKU sold per month, pipeline units, units at PO, stock, open PO, months of cover.
- **T22 · Hardening.** Error monitoring, rate limits on public routes, audit every Server Action for `assertCanEdit*`, slow-query check on the views, restore drill.
- **T23 · Review.** Three weeks of real data with Pak Jovian, retro with the reps, update targets, probabilities, rules.
