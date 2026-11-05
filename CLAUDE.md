# Fortu CRM

Internal sales CRM for Fortu Digital Indonesia (IFP smartboards, digital signage, LED videowalls).
Users: 4 sales reps, the Sales Manager (sales lead), Pak Jovian (CEO), marketing. Most are not technical.
Contracts and integration specs: `docs/INTEGRATIONS.md` (extract of the Claude Docs blueprint). Task prompts: `docs/prompts/`. Screens: `docs/design/*.png` keep the content and order of each screen; the look follows the visual system below (Sana Labs first, Attio for CRM screens, Nov 2026), which replaces the canvas styling.
Backlog: Linear project "Fortu CRM — MVP & Rollout" (team Fortu, MAR-…). Sales flow follows Pak Jovian's reference CRM.

## Stack
- One Next.js app (App Router, TypeScript, current stable) on Railway, `output: 'standalone'`. Server Components read the database; writes go through Server Actions. Public endpoints are Route Handlers.
- PostgreSQL on Railway. Client: `postgres` (postgres.js) tagged templates via `lib/db.ts`. No ORM.
- Auth.js v5 with Google. Tailwind CSS with the tokens below, `lucide-react` icons. `@dnd-kit/core` for the board. Vitest + Playwright.
- Railway services in one project: `web`, `postgres`, later `cron-insights` and `cron-sweeper` (same repo, different start command).
- Nothing Vercel-only: no Edge runtime, no `@vercel/*` packages, no ISR on-demand webhooks.

## Layout
```
app/(app)/beranda/page.tsx                Beranda (home): greeting, one search box, figures, Perlu perhatian
app/(app)/cari/page.tsx                   search across deals, contacts and companies (Cmd+K)
app/(app)/pipeline/page.tsx               Pipeline: Board / Ringkas / List
app/(app)/pipeline/@panel/(..)deal/[id]   deal opens as a side panel over the board (intercepting route)
app/(app)/deal/[id]/page.tsx              same deal as a full page (phones, shared links)
app/(app)/prospek/page.tsx                Prospek: chats not yet a deal
app/(app)/tambah/page.tsx                 Tambah cepat (phone quick-add)
app/(app)/kontak/page.tsx                 Kontak
app/(app)/perusahaan/page.tsx             Perusahaan
app/(app)/laporan/page.tsx                Laporan (CEO + sales lead; reps see their own)
app/(app)/pengaturan/...                  Settings: team, targets, rules, catalog/MSRP, stage definitions (admin/ceo)
app/api/v1/ingest/web-form/route.ts       signed POST from the fortu.co.id FastAPI backend
app/go/wa/route.ts                        tracked WhatsApp link → 302 to wa.me
app/api/auth/[...nextauth]/route.ts
lib/db.ts  lib/auth.ts  lib/authz.ts  lib/copy.ts  lib/format.ts  lib/stageRules.ts
lib/ingest/{ingestLead,phone,codes,owner}.ts
db/migrations/001_init.sql … 010_reports.sql
db/seeds/seed_products.sql
messages/id.json                          ALL user-facing text
public/brand/                             logos
```

## Rules that are not negotiable
1. **UI language is Bahasa Indonesia.** Every label, button, empty state, error and toast comes from `messages/id.json` through `t('key')`. No English string in a component, except the stage names and sales words the team already uses (Quotation, Negotiation, PO, Done deal, Lost, next step, win rate, run rate). Database keys and code stay English.
2. **Every lead enters through `ingestLead()`.** Quick-add, the web-form route, `/go/wa` matching and the future WhatsApp webhook all call it. Never insert into `leads` anywhere else.
3. **View all, edit own.** Any signed-in user may read every lead and deal. A write needs `can_edit_deal(user, deal)` / `can_edit_lead(user, lead)` = owner, `sales_lead`, `ceo` or `admin`. Every Server Action calls `assertCanEdit*()` from `lib/authz.ts` AND repeats the condition in the UPDATE's WHERE. Deleting a deal: `ceo`/`admin` only. Settings: `admin` and `ceo`.
4. **Stage rules live in the database** (`trg_deal_stage`, migration 004) and are mirrored in `lib/stageRules.ts` only to show errors before saving:
   - every open deal has `next_step` + `next_step_date`
   - from Quotation on (not Lost): at least one product with qty and price
   - Quotation, Negotiation, PO: `expected_close_date`
   - Lost: `lost_reason` (competitor optional). Done deal / Lost: `closed_on` (payment date for Done deal; defaults to today in Jakarta)
   The trigger raises `stage_rule:<key>`; map `<key>` to `t('stageRule.<key>')`. A failed drag opens the deal panel with the missing fields marked.
5. **Numbers come from SQL views**, never from totals computed in components: `v_deals_enriched`, `v_pipeline_summary`, `v_rep_scorecard`, `v_stage_conversion`, `v_ad_leakage_daily`, `v_units_won_monthly`, `v_target_attainment`, `v_sku_demand`, `v_deal_line_discounts`, `v_attention`, `v_contacts_followup`, `v_demo_effect_90d`, `v_lost_reasons_90d`, `v_sources_90d`, `v_leads_enriched`, `v_prospek_stats`, `v_pipeline_board`, `v_pipeline_summary_by_owner`, `v_contacts_enriched`, `v_companies_enriched`, `v_done_monthly`, `v_stage_summary_by_owner`, `v_win_rate_90d_by_owner`, `v_forecast_month_by_owner`.
6. **Deal amount follows its products.** `deals.amount` = sum of `deal_line_items.line_total` (trigger), or `est_amount` while no products are listed. Never let a user type the amount of a deal that has products.
7. **Money** is whole Rupiah before PPN (`numeric(15,0)`). Display: `Rp540.000.000` or `Rp540 jt`, `Rp1,12 M` (id-ID, comma decimals). Always say "sebelum PPN" once per screen, not per number.
8. **Time** is stored UTC, shown in `Asia/Jakarta`. Day/month grouping uses Jakarta time; `closed_on` is already a Jakarta date.
9. **Targets**: Rupiah per month (company and per rep, set in Pengaturan) and screen units (167/month from Jan 2027). Units count only `products.counts_as_screen` lines of Done deals.
10. **Discounts**: MSRP = `products.list_price`. Over `COALESCE(products.max_discount_pct, app_settings.max_discount_pct)` (15%) → `needs_discount_approval` until a ceo/admin approves (`discount_approved_by/at`).
11. Every DB write that moves a deal sets `SET LOCAL app.user_id = '<id>'` in the same transaction so the stage history records who did it.
12. Stage keys: `chat, quotation, negotiation, po, done, lost`. Names, probabilities, stale days and definitions live in `pipeline_stages`. Never hard-code a probability.

## Roles
| role | read all | edit own | edit others / reassign | delete deal | settings |
| --- | --- | --- | --- | --- | --- |
| sales_rep | yes | yes | no | no | no |
| sales_lead | yes | yes | yes | no | targets only |
| ceo | yes | yes | yes | yes | yes |
| admin | yes | yes | yes | yes | yes |
| marketing | yes | no | no | no | ads screen only |

## Visual system (after Sana Labs and Attio)
- Tokens live in `app/globals.css`. White canvas; sidebar and tiles paper `#F6F6F7`; hairlines `#ECECEF`; text ink `#0A0A0B`, slate `#6B6B73` (secondary), faint `#707078` (hints, 4.5:1 on paper). Near-black `#18181B` is the one accent (primary buttons, Done deal, active stage). Stage ramp, light to dark: `#E4E4E7`, `#C9C9CF`, `#A1A1AA`, `#52525B`, `#18181B`. Late only: `#A24A00` on `#FFF3E8`. Input borders `#8E8E96` (3:1 on white).
- Type: Inter (`next/font`), Helvetica Neue fallback. Semibold for titles and money, regular for body, tabular figures for amounts. Desktop with a mouse is dense (root 14 px, `desk:` variant for 36 px controls); phones and tablets keep 16 px and 44 px targets.
- Shell: a quiet left sidebar (icons + labels, Cari with Cmd+K, one black "Tambah prospek" pill, sales filter and user at the bottom); on phones a slim white bar with a menu sheet.
- Every screen starts with `PageHeader` (small title, faint note, actions right). Figures sit in a `StatStrip` without boxes; tabs are pill segments; tables are full width with hairlines, no card around them.
- Buttons are pills: black for the one primary action, white with a hairline for the rest. Radius 10 (controls), 14–18 (cards, panels). Cards: white with a hairline ring and a very soft shadow; the deal panel floats.
- Line icons from `lucide-react`, only in navigation, search and small actions. No gradients, glass, emoji, colored left borders or illustrations. Orange only means "late".
- Logos in `public/brand/`: `fortu-logo-navy.png` (sidebar, phone bar, sign-in), `fortu-mark-navy.png` → `app/icon.png`.
- Touch targets ≥ 44 px on phones. Quick-add inputs 48 px, 16 px text (no iOS zoom).

## Writing UI copy
- Short, plain, friendly. "kamu", never "Anda". One idea per line.
- Labels name the thing; they don't explain it. No helper paragraph under a screen title. A hint appears only where a field is easy to get wrong (one short line).
- Errors say what to do: "Isi next step dan tanggalnya." Not "Validasi gagal".
- Follow the CVC "Direction Avoidance" list: no hype ("tercanggih", "super", "wajib punya"), no exclamation marks.

## Git and commits
- `main` is always green. One task = one branch from `main`: `adibwafi/mar-<linear#>-t<nn>-<slug>` (e.g. `adibwafi/mar-141-t01-scaffold`). Never commit to `main` directly after the first commit.
- Conventional Commits, in English: `type(scope): summary`. Imperative mood, lower case after the colon, no period, ≤ 72 chars.
  - types: `feat` `fix` `refactor` `test` `docs` `build` `ci` `chore` `perf` `style` (formatting only)
  - scopes: `db` `auth` `copy` `ui` `shell` `ingest` `leads` `pipeline` `deal` `contacts` `companies` `reports` `settings` `jobs` `api` `deploy` `deps`
- One logical change per commit, in the order the work happened. Every commit builds, lints and passes tests. Config/dependencies, schema/scripts, domain logic, UI, and docs go in separate commits; tests go with the code they cover. Never mix a refactor or formatting with a behavior change.
- Body (wrapped at 72) says what changed for the user and why, not how. Last line: `Part of MAR-<n>`.
- Commit after each step of the task's commit plan, not all at the end. Never commit `.env*` (except `.env.example`), `node_modules`, build output, or local seeds.
- Don't push or open a PR unless asked. PR title = task title; body = summary, verification output, and `Closes MAR-<n>` on the last task of a Linear item, otherwise `Part of MAR-<n>`.

## Commands
```
npm run dev          # local, needs DATABASE_URL
npm run db:migrate   # applies db/migrations/*.sql in order, records them in schema_migrations
npm run db:seed      # db/seeds/*.sql (re-runnable)
npm run db:up        # local Postgres 16 in Docker (fortu-pg)
npm run db:test:reset # recreate the fortu_test database and migrate it (Vitest uses DATABASE_URL_TEST)
npm test             # vitest
npm run e2e          # playwright
```

## Env
`DATABASE_URL`, `DATABASE_URL_TEST` (local only), `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL` (Railway public URL), `WEBFORM_HMAC_SECRET`.
Week 2+: `META_SYSTEM_USER_TOKEN`, `META_AD_ACCOUNT_ID`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`. Cloud API move: `META_APP_SECRET`, `META_VERIFY_TOKEN`.
