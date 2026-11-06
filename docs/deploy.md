# Deploy on Railway

One Railway project, one repo, several services. Every service builds with `npm run build` (this also compiles `jobs/*.ts` to `jobs/*.js`).

| Service | Start command | Schedule |
| --- | --- | --- |
| `web` | `npm start` | always on (railway.json also runs `npm run db:migrate` before each deploy) |
| `postgres` | Railway Postgres plugin | always on |
| `cron-insights` | `node jobs/insights-sync.js` | `0 19 * * *` (19:00 UTC = 02:00 Jakarta) |
| `cron-sweeper` | `node jobs/sweeper.js` | `0 1-13 * * *` (01:00–13:00 UTC = 08:00–20:00 Jakarta, every hour) |

## cron-insights (Meta ad insights, T13)
Pulls the last 3 days of ad insights from the Meta Marketing API every night and upserts them (Meta restates recent figures).

1. In the Railway project, add a service from the same repo. Name it `cron-insights`.
2. Settings → Config-as-code → **Config file path**: `railway.cron-insights.json`. This file sets the start command (`node jobs/insights-sync.js`), the cron schedule (`0 19 * * *`) and no migration step. It is needed because `railway.json` (used by `web`) starts the web server and would otherwise apply to this service too.
3. Variables (reference the `web` service's `DATABASE_URL`, do not copy it):
   - `DATABASE_URL`
   - `META_SYSTEM_USER_TOKEN` – token of the system user with `ads_read` on the ad account
   - `META_AD_ACCOUNT_ID` – the account number (`1414727130175042`, with or without `act_`)
   - `META_GRAPH_VERSION` – optional, default `v24.0`
4. Check: Deployments → the run should end with `insights-sync ok from=… to=… rows=… ads=… spend=Rp… conversations=…`. A failed run exits with 1 and shows as failed. Pengaturan › Iklan also shows when Meta was last read, or why it failed.

The service builds the whole app (`npm run build`) so the job gets compiled; that is slow but only happens on deploy.

If Meta answers "too many requests", the job waits 30 s, 1 min, 2 min, 4 min (or what Meta says) before giving up. The ad account must be in **IDR**: the job refuses any other currency.

A backfill (once, from a computer with the variables in `.env.local`):

```bash
npm run build
npm run insights:sync -- --from 2026-10-24 --to 2026-10-30
```

Ranges are cut into 14-day requests. Re-running a range is safe: rows are upserted on (ad, date).

## cron-sweeper (reminders, T16)
Every hour from 08:00 to 20:00 Jakarta it looks for deals that need someone and writes the reminders that show in the bell. Big deals and stuck deals are also emailed.

1. In the Railway project, add a service from the same repo. Name it `cron-sweeper`.
2. Settings → Config-as-code → **Config file path**: `railway.cron-sweeper.json` (start command, cron schedule `0 1-13 * * *`, no migration step).
3. Variables (reference the `web` service's `DATABASE_URL`, do not copy it):
   - `DATABASE_URL`
   - `AUTH_URL` – the public address of the app, used for the links in emails and reminders
   - `SMTP_HOST` – `smtp.hostinger.com`
   - `SMTP_PORT` – `465` (SSL; this is the default)
   - `SMTP_USER` – the mailbox that sends (for example `crm@fortu.co.id`)
   - `SMTP_PASS` – that mailbox's password
   - `SMTP_FROM` – optional, defaults to `SMTP_USER`
4. Check: Deployments → a run ends with `sweeper ok high_value_lead=… stale_deal=… won=… next_step_overdue=… discount_approval=… emails=… items=… failed=0`. A failed run exits with 1 and shows as failed. Without the `SMTP_*` variables it prints `email skipped` and the bell still works.

What it sends, and to whom:

| Reminder | When | To | Email |
| --- | --- | --- | --- |
| Deal besar | a deal created or re-priced to Rp100 jt+ in the last 2 days | CEO, sales leads | yes |
| Belum bergerak | a Rp100 jt+ deal sits past its stage's stale days | owner on the first day, CEO from the second day (once) | yes |
| Done deal | a deal is paid today | CEO, sales leads, owner | no |
| Next step terlambat | the next step date has passed | owner, once a day | no |
| Diskon perlu disetujui | a discount is above the limit | CEO, once | no |

Each person gets at most one reminder per kind, deal and day, so running the job again (or manually) is safe. One email per person per run lists all their deals. If the mail server is down, the next run sends it.

A manual run (from a computer with the variables in `.env.local`):

```bash
npm run build
npm run sweeper:run
```

## Variables on `web`
See `.env.example`. Meta variables are only needed on `cron-insights` until the WhatsApp Cloud API webhook (T19).

## Hardening (T22)

### Rate limits
In memory, per `web` instance (one instance today; with two the limits double). They reset when the service restarts.

| Where | Limit | Over the limit |
| --- | --- | --- |
| `POST /api/v1/ingest/web-form` | 60 / min per IP, 300 / min in all, checked before the body is read | 429 `rate_limited`, `Retry-After: 60` |
| `GET` and `HEAD /go/wa` | 20 / min per IP, 600 / min in all | 429, `Retry-After: 60` |
| Password sign-in | 10 wrong passwords per email and 30 per IP in 15 min (only misses count) | sign-in refused like a wrong password, even with the right one, until the window passes |
| `/api/health` | none (Railway's healthcheck) | – |

The IP is the **last** `x-forwarded-for` entry (the one Railway's proxy adds). The web-form caller is the fortu.co.id backend, so all its requests share one IP: its normal traffic is a few a minute.

### Headers and cookies
`next.config.ts` sends on every response: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment off) and, in production, `Strict-Transport-Security: max-age=31536000`. `X-Powered-By` is off.

The CSP allows only our own origin for scripts, styles, images, fonts and connections, forbids framing (`frame-ancestors 'none'`), `<object>` and a changed `<base>`, and lets forms go to us and `https://accounts.google.com` (Google sign-in). It has no nonce: the app uses Cache Components (partial prerendering), which Next.js documents as incompatible with nonces, so inline scripts and styles are allowed (`'unsafe-inline'`). If a new outside host is ever needed (an analytics script, a font CDN), add it to `lib/securityHeaders.ts`; the browser console shows `Refused to load …` when something is blocked.

Cookies are Auth.js's: with `AUTH_URL` on `https://…` the session cookie is `__Secure-authjs.session-token` and the CSRF cookie `__Host-authjs.csrf-token`, both `Secure`, `HttpOnly`, `SameSite=Lax` (`tests/securityHeaders.test.ts`). Keep `AUTH_URL` on the https address, or the cookies lose `Secure`. The sales filter cookie is `Secure` in production, `HttpOnly`, `SameSite=Lax`.

### Errors and logs
No paid monitoring. A failed request writes one line to the `web` log:

```
{"event":"request_error","name":"Error","digest":"2689830951","method":"GET","path":"/pipeline","routePath":"/pipeline","routeType":"render","at":"…"}
```

It holds no message, query string, headers or body (they can quote a customer's phone number). The same `digest` is shown to the person on the error page as "Kode: …", so a report matches a line. Search it in Railway → `web` → Logs with `request_error`.

Railway alerts on a failed or crashed deployment, not on a log text. Set that up once: Project → Settings → Notifications (email, or a webhook to a chat), tick *Deploy failed* and *Deploy crashed*, and do the same for `cron-insights` and `cron-sweeper` (a failed run shows as failed). In the first weeks, open `web` Logs once a day with the filter `request_error` and `failed`. If errors turn out to be frequent, add Sentry then (it needs its own account and DSN).

### Indexes (migration 015)
EXPLAIN ANALYZE on a throwaway database with demo data x10 (3.000 deals, 6.000 product lines, 8.000 contacts, 1.500 companies, 20.000 prospects, 40.000 activities, 9.600 ad days). The five heaviest queries, median of 3 runs, before and after `015_report_indexes.sql` (`deal_line_items(deal_id)`, `deals(contact_id)`, `deals(company_id)`):

| Query | Before | After |
| --- | --- | --- |
| Pipeline board (`v_pipeline_board`, 500 cards) | 600 ms | 22 ms |
| Laporan scorecard (`v_rep_scorecard`) | 851 ms | 25 ms |
| Pipeline summary by owner | 827 ms | 19 ms |
| Perusahaan list (`v_companies_enriched`, 50 rows) | 48 ms | 37 ms |
| Kontak list (`v_contacts_enriched`, 50 rows) | 209 ms | 201 ms |

Kontak stays at about 200 ms: it has to work out "chat terakhir" for every contact before sorting, and no index changes that. It is fine at 8.000 contacts; revisit above about 50.000. The number 015 is on purpose: the open pull requests use 013 and 014 (the migration runner applies files it has not seen, in name order, so they still apply later).

### Restore drill
**Rehearsed here (local Postgres 16, `pg_dump -Fc` and `pg_restore` into a temporary database, 6 November 2026):** data as above, 4,9 MB dump. Dump 0,43 s, restore 0,61 s, no errors. Row counts equal in the source and the restored copy: users 11, contacts 8.000, leads 20.000, deals 3.000, deal_line_items 6.000, activities 40.000, schema_migrations 14. The real database is smaller than this, so expect seconds. Network time to Railway is extra.

```bash
docker exec fortu-pg psql -U postgres -c "CREATE DATABASE fortu_restore"
docker exec fortu-pg pg_dump -U postgres -Fc -f /tmp/drill.dump <source database>
time docker exec fortu-pg pg_restore -U postgres --no-owner --exit-on-error -d fortu_restore /tmp/drill.dump
# compare: select count(*) from users / contacts / leads / deals ... in both databases
docker exec fortu-pg psql -U postgres -c "DROP DATABASE fortu_restore"
```

**To rehearse on Railway (needs the dashboard, so it cannot be done from the repo). About 20 minutes, do it once before the review and note the times here:**

1. Write down the time. Dashboard → `Postgres` → **Backups** → confirm last night's daily backup is listed (time and size).
2. Do **not** restore over the live database. Add a second Postgres: project canvas → **New** → **Database** → **PostgreSQL**; name it `postgres-drill`.
3. On `Postgres` → Backups, a backup can be restored in place only. So take the file route instead: on your computer, `railway run -s Postgres bash -c 'pg_dump "$DATABASE_PUBLIC_URL" -Fc -f ~/fortu-backups/drill.dump'` (this is a fresh dump of now; it proves the same path, and Railway's own backup is checked in step 1).
4. Restore it into the drill database: `railway run -s postgres-drill bash -c 'time pg_restore --no-owner --exit-on-error -d "$DATABASE_PUBLIC_URL" ~/fortu-backups/drill.dump'`. Write down the time.
5. Compare counts on both: `railway run -s <service> bash -c 'psql "$DATABASE_PUBLIC_URL" -tAc "select (select count(*) from users), (select count(*) from contacts), (select count(*) from leads), (select count(*) from deals)"'`. They must match (a few more in the source if someone worked in between).
6. Optional, to prove the app works on it: set `DATABASE_URL` of a temporary `web` copy (or your laptop's `.env.local`) to the drill database and sign in.
7. Delete `postgres-drill` and `~/fortu-backups/drill.dump`.
8. Real emergency (data lost): `Postgres` → Backups → pick the last good backup → **Restore** (replaces the live data; everything after the backup is lost, so note the time first), then check `/api/health` and sign in.
