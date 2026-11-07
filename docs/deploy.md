# Deploy on Railway

One Railway project, one repo (`Stratigo-Agency/fortu-crm`), several services. Every service builds with `npm run build` (this also compiles `jobs/*.js`).

Two environments in the project: **production** (the real team, no demo data) and **staging** (a copy to test on, with demo data). Steps below say which one when it matters. You run the Railway steps; this page has the exact commands. If a flag differs in your CLI version, `railway <command> --help` shows it.

## 0. Before you start

- Railway account with the **Pro** plan (backups need it). Install the CLI: `brew install railway`, then `railway login`.
- Node 24 and this repo on your computer, `npm install` done.
- Google Cloud project with an OAuth client (the one you use locally is fine; you add redirect addresses to it).
- `psql` and `pg_dump` for backups: `brew install libpq` (then `brew link --force libpq`).

## 1. Create the project, Postgres and `web`

```bash
cd fortu-crm
railway init --name fortu-crm            # creates the project (its first environment is "production")
railway add --database postgres          # the Postgres service, named "Postgres" (keep the name: the variables below use it)
```

Add the app from GitHub, in the dashboard (the CLI cannot authorise GitHub for you):

1. Project → **New** → **GitHub Repo** → `Stratigo-Agency/fortu-crm`. Name the service `web`.
2. `web` → Settings → Source: branch `main`.
3. `railway.json` in the repo already sets the build (`npm run build`), the migration step before each deploy (`npm run db:migrate`), the start command (`npm start`) and the healthcheck (`/api/health`). Nothing to type in Settings.
4. `web` → Settings → Networking → **Generate Domain**. Write the address down: `https://<name>.up.railway.app`. This is `AUTH_URL`.

Link your terminal to the project so the commands below find it:

```bash
railway link                              # pick fortu-crm, environment production, service web
```

## 2. Backups for Postgres

Dashboard → `Postgres` service → **Backups** tab → turn on **Daily** and **Weekly** schedules. Check one appears in the list the next day.

Also take a manual copy before anything risky (a big migration, loading data). Run it on your computer:

```bash
mkdir -p ~/fortu-backups
railway run -s Postgres bash -c 'pg_dump "$DATABASE_PUBLIC_URL" -Fc -f ~/fortu-backups/fortu-$(date +%Y%m%d-%H%M).dump'
ls -lh ~/fortu-backups
```

`DATABASE_PUBLIC_URL` is the address of the database reachable from outside Railway. `railway run` puts the service's variables into the command, nothing is printed.

## 3. Environment variables on `web`

Make the secrets once. Keep the output in your password manager, not in a file in the repo:

```bash
openssl rand -base64 33    # AUTH_SECRET
openssl rand -hex 32       # WEBFORM_HMAC_SECRET (the website team puts the same value on the FastAPI service)
```

Then set them. Replace the `<…>` parts; keep the single quotes (they stop the shell from touching `${{…}}`):

```bash
railway variables -s web \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set 'AUTH_SECRET=<from openssl>' \
  --set 'AUTH_URL=https://<name>.up.railway.app' \
  --set 'AUTH_TRUST_HOST=true' \
  --set 'AUTH_GOOGLE_ID=<from Google Cloud>' \
  --set 'AUTH_GOOGLE_SECRET=<from Google Cloud>' \
  --set 'WEBFORM_HMAC_SECRET=<from openssl>' \
  --set 'HOSTNAME=0.0.0.0'
```

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | reference to the Postgres service (Railway's private network). Do not paste the real address. |
| `AUTH_SECRET` | signs the sign-in cookie |
| `AUTH_URL` | the public address; sign-in redirects and links in emails use it |
| `AUTH_TRUST_HOST` | Railway sits behind a proxy; Auth.js needs to trust it |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | the "Masuk dengan Google" button shows only when `AUTH_GOOGLE_ID` is set |
| `WEBFORM_HMAC_SECRET` | checks the signature of leads from the website |
| `HOSTNAME` | makes the server listen on all addresses so the healthcheck can reach it |

`META_*` and `SMTP_*` belong to the cron services (sections below), not to `web`. Do not set `DATABASE_URL_TEST`, `E2E` or `NEXT_DIST_DIR` here, and on production never `SHOW_SAMPLE_DATA` (staging only, section 7).

Check the list: `railway variables -s web`. Values stay hidden in the dashboard unless you click them.

## 4. Google sign-in: add the Railway address

Google Cloud console → APIs & Services → **Credentials** → your OAuth 2.0 client:

- **Authorised JavaScript origins**: add `https://<name>.up.railway.app`
- **Authorised redirect URIs**: add `https://<name>.up.railway.app/api/auth/callback/google`

Save (it can take a few minutes to apply). Keep the `http://localhost:3000/...` entries for local work. For staging add its own address the same way.

Only people with an active row in `users` can sign in, so load the team before testing (section 6).

## 5. Deploy and check

Dashboard → `web` → Deployments → the deploy starts by itself after the variables are saved (or `railway redeploy -s web -y`). A good deploy shows, in order: build, `applied 0xx_….sql` / `skipped …` lines from the migration step, the healthcheck passing, then **Active**.

From your computer:

```bash
curl -s https://<name>.up.railway.app/api/health          # {"status":"ok","db":"ok","version":"<commit>"}
curl -sI https://<name>.up.railway.app/masuk | head -1    # HTTP/2 200
curl -sI https://<name>.up.railway.app/pipeline | head -3 # 307 to /masuk?next=%2Fpipeline
```

If the deploy fails the healthcheck, Railway keeps the previous version running. Read Deployments → View logs.

### Migrations by hand

Every deploy already runs them (`preDeployCommand`). To run or check them yourself from your computer, point the scripts at the public database address for one command:

```bash
railway run -s Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npm run db:migrate'
```

A run prints `applied …` for new files and `skipped …` for the rest. Stops at the first error and rolls that file back.

## 6. Load the catalog and the real team (production)

Never run plain `npm run db:seed` on production: it also loads the five `@example.com` example users. Use `--only`.

1. Make sure `db/seeds/90_users.local.sql` on your computer lists the real team (full name, work email, role). It is gitignored; it never goes to GitHub or Railway.
2. Load the product catalog and the team:

```bash
railway run -s Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npm run db:seed -- --only seed_products.sql 90_users.local.sql'
```

3. People who use Google sign in with their work address, nothing more. For people without a Google account, give a password (random, written to `credentials.local.txt` on your computer; hand each person their line, then delete the file):

```bash
railway run -s Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npm run db:set-password -- rudy@fortu.co.id dimas@fortu.co.id'
```

4. In the CRM: sign in as admin → Pengaturan → set the targets, MSRP per product and the discount limit before the briefing.

## 7. Staging with demo data

Create the staging environment as a copy of production, then give it its own Google redirect address and its own secrets:

```bash
railway environment new staging --duplicate production
railway environment staging
railway domain -s web                                   # staging gets its own address
railway variables -s web --set 'AUTH_URL=https://<staging-name>.up.railway.app'
railway variables -s web --set 'AUTH_SECRET=<a new one from openssl>'
```

(Add the staging redirect address in Google Cloud, section 4.) Staging has its own empty database. Load the team as in section 6, then the demo data:

```bash
railway run -s Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" ALLOW_DEMO=1 npm run db:demo'
```

Check `railway status` first: it must say environment `staging`. The script also prints `database: <host>/<name>` before it changes anything. It adds 4 demo reps (`@demo.fortu.invalid`), 25 deals (each with the lead it came from: Iklan Meta with an ad code, Website with UTM and landing page, Offline, WhatsApp langsung), 10 more prospects, and 4 demo ads (`Z-` codes) with 14 days of insights. Every row is marked sample (`is_sample`). Running it again resets the demo rows. It stops if the database already holds real deals, prospects, contacts or companies (the team's users are fine). Only if you are sure, add `--allow-real-data` after `npm run db:demo --`.

**Demo rows and the figures.** Because they are `is_sample`, demo leads are left out of the Lead dan funnel figures on Laporan, the Prospek list and its figures, and the leads count on the ads screen. On production that never changes. To see them on staging, set this on the staging `web` service only and redeploy:

```bash
railway variables -s web --set 'SHOW_SAMPLE_DATA=1'    # staging only
```

The app then opens its database connections with `app.show_sample_data = on` (migration 019), and those figures include the demo rows. It is off unless the value is exactly `1`. Never set it on production; `railway variables -s web` should not list it there. Deals, Pipeline and the other Laporan figures always show demo deals.

Remove it (safe on any database, it only touches rows marked sample):

```bash
railway run -s Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npm run db:demo:clear'
```

**Never run `db:demo` against production.** The script refuses without `ALLOW_DEMO=1` and on a database with real data, so do not put that variable in a Railway service or in `.env.local`.

## 8. Roll back

**A bad deploy of the app** (page errors, wrong behaviour; the database is fine): Dashboard → `web` → Deployments → pick the last good one → ⋮ → **Rollback** (older versions: **Redeploy**). It reuses the old build, so it takes seconds. Then fix on a branch and ship again. Migrations are not undone by a rollback. They only add things, so the old app keeps working with the new tables.

**A bad migration or bad data** (the database is the problem):

1. Stop new writes: `web` → Settings → pause the service (or remove its domain).
2. Restore: Dashboard → `Postgres` → **Backups** → pick the last good backup → **Restore**. This replaces the current data with the backup. Everything after that backup is lost, so note the time first.
   Or from your own dump (section 2) into the same database:
   ```bash
   railway run -s Postgres bash -c 'pg_restore --clean --if-exists --no-owner -d "$DATABASE_PUBLIC_URL" ~/fortu-backups/<file>.dump'
   ```
3. Roll `web` back to the deploy from before the migration (above), then resume it.
4. `curl https://<name>.up.railway.app/api/health` must answer `ok`, then sign in and look at Pipeline.

**Demo data loaded by mistake on production:** `db:demo:clear` (section 7) removes it and nothing else.

## 9. Staging checks (after each staging deploy)

By curl:

```bash
curl -s https://<staging>/api/health                      # status ok, db ok
curl -sI https://<staging>/masuk | head -1                # 200
curl -sI https://<staging>/pipeline | head -3             # 307 to /masuk
curl -si "https://<staging>/go/wa?line=<a line label>" | head -1   # 302; an unknown line is 404, never 500
```

By hand, signed in as a sales rep (a phone for the first two):

1. Masuk dengan Google, and with email and password.
2. Tambah cepat: a number and a message with an ad code → "Prospek tersimpan." and the ad shows.
3. Prospek → Jadikan deal → add a product → Simpan.
4. Pipeline: drag the card to Negotiation; drag a card without a product and see what is asked.
5. Change a next step date to yesterday: the card turns orange.
6. Mark a deal Lost with a reason.
7. Open another rep's deal: it is read-only. `/pengaturan` is refused.
8. Laporan: figures show, switching the period works.
9. As Pak Jovian (CEO): a deal with a discount above 15% shows the tag; "Setujui diskon" clears it.
10. The bell shows reminders after the next `cron-sweeper` run; Pengaturan › Iklan shows when Meta was last read.

## Services at a glance

| Service | Start command | Schedule |
| --- | --- | --- |
| `web` | `npm start` | always on (railway.json also runs `npm run db:migrate` before each deploy) |
| `postgres` | Railway Postgres plugin | always on |
| `cron-insights` | `node jobs/insights-sync.js` | `0 19 * * *` (19:00 UTC = 02:00 Jakarta) |
| `cron-sweeper` | `node jobs/sweeper.js` | `0 1-13 * * *` (01:00–13:00 UTC = 08:00–20:00 Jakarta, every hour) |
| `cron-accurate` | `node jobs/accurate-sync.js` | `0 18 * * *` (18:00 UTC = 01:00 Jakarta) |
| `cron-retry-inbound` | `node jobs/retry-inbound.js` | `*/5 * * * *` (every 5 minutes; only needed once a WhatsApp line is connected) |

The two cron services are added after `web` works. Each has its own section below.

## cron-insights (Meta ad insights, T13)
Pulls the last 3 days of ad insights from the Meta Marketing API every night and upserts them (Meta restates recent figures).

1. In the Railway project, add a service from the same repo. Name it `cron-insights`.
2. Settings → Config-as-code → **Config file path**: `railway.cron-insights.json`. This file sets the start command (`node jobs/insights-sync.js`), the cron schedule (`0 19 * * *`) and no migration step. It is needed because `railway.json` (used by `web`) starts the web server and would otherwise apply to this service too.
3. Variables (reference the `web` service's `DATABASE_URL`, do not copy it):
   - `DATABASE_URL`
   - `META_SYSTEM_USER_TOKEN` – token of the system user with `ads_read` on the ad account
   - `META_AD_ACCOUNT_ID` – the ad account number (digits only or with `act_`; Meta shows it in Ads Manager, never commit it)
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
Every hour from 08:00 to 20:00 Jakarta it reminds each sales rep about their own deals: the reminders show in the bell and are also emailed to that rep. Nobody is told about someone else's deals: Pak Jovian asked for no alerts about deals (big, stuck, won or discounted), so the CEO, the sales leads and admins only get reminders about deals they own. Discounts waiting for approval are listed in Laporan, not pushed.

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
4. Check: Deployments → a run ends with `sweeper ok stale_deal=… next_step_overdue=… emails=… items=… failed=0`. A failed run exits with 1 and shows as failed. Without the `SMTP_*` variables it prints `email skipped` and the bell still works.

What it sends, and to whom:

| Reminder | When | To | Email |
| --- | --- | --- | --- |
| Belum bergerak | a Rp100 jt+ deal sits past its stage's stale days | owner only, once until the deal moves | yes |
| Next step terlambat | the next step date has passed | owner only, once a day | yes |

A deal whose owner is inactive gets no reminder; reassign it in Pengaturan. Old "Deal besar", "Done deal" and "Diskon perlu disetujui" reminders already in the bell stay readable, but no new ones are made.

Each person gets at most one reminder per kind, deal and day, so running the job again (or manually) is safe. One email per person per run lists all their deals. If the mail server is down, the next run sends it.

A manual run (from a computer with the variables in `.env.local`):

```bash
npm run build
npm run sweeper:run
```

## cron-accurate (Accurate sync, read-only, T20)
Every night at 01:00 Jakarta it reads from Accurate Online and fills `products` (Accurate id, type, unit, barcode, category), `inventory_snapshots` (today, one row per warehouse), `purchase_orders` (open lines) and `sales_monthly` (this month and the two before). The CRM never writes to Accurate: the client only has GET helpers and refuses any path that is not `list.do`, `detail.do`, `list-stock.do` or `get-stock.do`.

1. In the Railway project, add a service from the same repo. Name it `cron-accurate`.
2. Settings → Config-as-code → **Config file path**: `railway.cron-accurate.json` (start command `node jobs/accurate-sync.js`, cron `0 18 * * *`, no migration step).
3. Variables (reference the `web` service's `DATABASE_URL`, do not copy it):
   - `DATABASE_URL`
   - `ACCURATE_API_TOKEN` – the API Token of the Accurate application (read scopes only)
   - `ACCURATE_SIGNATURE_SECRET` – the signature secret that belongs to that token
   - `ACCURATE_HOST` – optional, e.g. `https://zeus.accurate.id`; empty = looked up from the token
   - `ACCURATE_DATABASE_ID` – optional; empty = looked up from the token
4. Scopes the token needs: `item_view`, `purchase_order_view`, `sales_invoice_view` (and the warehouse list). Nothing else.
5. Check: Deployments → the run ends with `accurate-sync ok {"productsChanged":…}`. A failure exits with 1.

Things to know about the numbers:
- **Snapshot date.** The run is at 01:00 Jakarta, so the snapshot dated that day is the stock at the close of the day before. The date is the Jakarta date (17:00-24:00 UTC is already the next day).
- **PO quantity.** If a PO line shows what is still open (`remainingQuantity`, `outstandingQuantity`, `unprocessedQuantity` or `quantityRemaining`), the CRM uses that. We have not confirmed against a live database that Accurate sends one of these; when none is present the full ordered quantity is used, so a partly received PO line counts its whole quantity until the PO is closed.
- **Closing PO lines.** A saved open line is closed only when Accurate lists its PO with a closed status (Diproses, Ditutup, ...) or, for a PO listed open, the line is no longer in its detail. POs older than the 12-month window or missing from the list are never closed. Nothing closes if the list is empty or has no open PO, and at most 25% of the open lines (minimum 5) close per run; the run says so in a `WARNING` line and exits 1 so Railway shows it. Lines the CRM marked received or cancelled are not reopened.
- **Held back parts.** If all stock quantities come back 0 although Accurate has stock items, the stock part is skipped (today's earlier snapshot stays). Items with an item type the CRM does not know are left alone and listed in the log. A skipped stock part makes the run exit 1 after the safe parts were applied.
- **Sales invoices.** Void or draft invoices are not filtered out: we have not found a documented status field to filter on, so they are counted. Each invoice is one detail call (up to 5000 per run; the run stops above that), paused 100 ms between calls.
- **Safety.** The client calls only the listed GET endpoints with known parameters, does not follow redirects, and accepts only an `https://<name>.accurate.id` host (from `ACCURATE_HOST` or the token lookup). Two overlapping runs are serialised with a Postgres advisory lock.

Rules the job follows:
- Match on `products.sku` = Accurate "Kode Barang". Products are never created or deleted; `is_active` is never changed.
- A name or `list_price` already in the CRM is never overwritten. A price from Accurate fills only an empty (or Rp0) CRM price, and only when Accurate's is above 0. The first export had Rp0 everywhere, so today this writes no price.
- At the end of every run it lists SKUs in Accurate but not in the CRM, and SKUs in the CRM but not in Accurate. Add the first group in Pengaturan › Katalog, or fix the SKU on one side.
- An Accurate id already used by another CRM product is reported as a conflict and skipped.
- A PO line saved earlier that Accurate no longer lists as open is marked `received`. POs entered by hand in the CRM are left alone.
- Sales are recomputed for the window, from sales invoices (not returns). Open POs are those with status "Menunggu diproses" or "Sebagian diproses".

A dry run prints what would change and writes nothing (from a computer with the variables in `.env.local`):

```bash
npm run build
npm run accurate:sync -- --dry-run
npm run accurate:sync -- --months 6   # a longer sales window
```

Sources used for the client (read 6 Nov 2026):
- API overview, auth and host/session: https://accurate.id/api-integration/ , https://accurate.id/api-integration/oauth , https://accurate.id/api-integration/api-example/
- Endpoint list and parameters (OpenAPI): https://account.accurate.id/open-api/json.do (`item/list.do`, `item/list-stock.do`, `warehouse/list.do`, `purchase-order/list.do` + `detail.do`, `sales-invoice/list.do` + `detail.do`; dates as `dd/MM/yyyy`; paging `sp.page`, `sp.pageSize`)
- API docs: https://account.accurate.id/developer/api-docs.do

Not verified against a live database (no credentials yet): the API Token header scheme (`Authorization: Bearer`, `X-Api-Timestamp` as `dd/MM/yyyy HH:mm:ss`, `X-Api-Signature` = base64 HMAC-SHA256 of the timestamp with the signature secret, host from `https://account.accurate.id/api/api-token.do`; Accurate documents it in a separate PDF), and the exact response field names of `list-stock.do`, `detail.do` (PO and invoice) and `statusName`. The tests use synthetic answers written from the documented shapes. Run `--dry-run` first with the real token and compare.

## cron-retry-inbound (WhatsApp webhook retries, T19)
The `web` service answers Meta's webhook at once and processes the event right after the answer. If that fails
(a deploy restarts the service, the database blips), the event stays in `inbound_events` with `processed_at` empty.
This job processes such events once they are older than 2 minutes, at most 5 tries each; the reason of the last
failure is in `inbound_events.error` (an error name, never message text). Processing twice is safe: one message id
is one lead.

1. In the Railway project, add a service from the same repo. Name it `cron-retry-inbound`.
2. Settings → Config-as-code → **Config file path**: `railway.cron-retry-inbound.json` (start command
   `node jobs/retry-inbound.js`, cron `*/5 * * * *`, no migration step). Five minutes is Railway's shortest cron.
3. Variables: `DATABASE_URL` (reference the `web` service's). Nothing else: the retry calls no Meta API.
4. Check: Deployments → a run ends with `retry-inbound ok found=0 processed=0 failed=0`. A run where an event failed
   again exits with 1.

A manual run (from a computer with the variables in `.env.local`):

```bash
npm run build
npm run inbound:retry
```

Events that failed 5 times (look at them before deleting anything):

```sql
SELECT id, received_at, attempts, error FROM inbound_events
 WHERE provider = 'whatsapp_webhook' AND processed_at IS NULL ORDER BY received_at;
```

## WhatsApp webhook on `web` (T19)
Only when a rep's number is moved to Coexistence (docs/whatsapp-coexistence.md). On `web`:
- `META_APP_ID` – the Meta app (Tech Provider) id
- `META_APP_SECRET` – its app secret: checks `X-Hub-Signature-256` and swaps the signup code for a token
- `META_VERIFY_TOKEN` – any long random text; type the same text in the app's webhook settings
- `META_ES_CONFIG_ID` – the Embedded Signup configuration id (Facebook Login for Business › Configurations)
- `META_GRAPH_VERSION` – optional, default `v24.0`
- `WA_TOKEN_KEY` – optional; the key the business tokens are encrypted with. Empty = derived from `AUTH_SECRET`.
  Changing it (or `AUTH_SECRET` when it is empty) makes stored tokens unreadable: connect the numbers again.

Webhook URL for Meta: `<AUTH_URL>/api/v1/webhooks/whatsapp` (https only). Without these variables the webhook
answers 500 to Meta (it retries) and Pengaturan › WhatsApp shows a note instead of the button.

## Variables on `web`
See `.env.example`. Meta variables are needed on `cron-insights`, and on `web` once a WhatsApp line is connected (above).

## Hardening (T22)

### Rate limits
In memory, per `web` instance (one instance today; with two the limits double). They reset when the service restarts.

| Where | Limit | Over the limit |
| --- | --- | --- |
| `POST /api/v1/ingest/web-form` | 60 / min per IP (checked before the body is read); 300 / min in all, counted only for requests with a valid signature | 429 `rate_limited`, `Retry-After: 60` |
| `GET` and `HEAD /go/wa` | 20 / min per IP, 600 / min in all | 429, `Retry-After: 60` |
| Password sign-in | 10 wrong passwords per email **and** IP, 30 per IP, in 15 min (only misses count). Per email alone it only slows (each try waits 0,8 s from 10 misses) and refuses at 50. With no address header: 20 per email | sign-in refused like a wrong password, even with the right one, until the window passes. A colleague typing wrong passwords for your email can't lock you out from your own IP |
| `GET` and `POST /api/v1/webhooks/whatsapp` | only failures count: 60 bad signatures or verify tokens / min per IP, then that IP is refused before its body is read. A correctly signed request is never refused for volume (a history sync sends many at once) | 429, `Retry-After: 60` |
| `/api/health` | none (Railway's healthcheck) | – |

The IP is the **last** `x-forwarded-for` entry (the one Railway's proxy adds). The web-form caller is the fortu.co.id backend, so all its requests share one IP: its normal traffic is a few a minute.

**The FastAPI caller should retry on 429**, waiting the number of seconds in `Retry-After` (`docs/fastapi_forwarder.py` does). Reusing the same `submission_id` makes the retry safe.

#### Check the client address (once, after the first deploy)
We assume Railway puts the visitor's address last in `x-forwarded-for`. That has not been seen on the real service yet. After the first deploy, make one real request and look at the log:

```
curl -s -o /dev/null -w "%{http_code}\n" "https://<your-web-domain>/go/wa?line=tidak-ada"
```

Then open Railway → `web` → Logs. If the line `rate limit: request without x-forwarded-for or x-real-ip; all such requests share one 'unknown' address` appears, the header is not what we assume: tell the developer before relying on the limits. If it does not appear, the address is being read. (Password sign-in does not lump unknown addresses together: it limits per email, 20 in 15 min.) If the address were wrong in the other direction (always Railway's own), all visitors would share one bucket: the web-form and `/go/wa` limits would then hit everyone, so also check that two requests from different networks (your laptop and your phone on mobile data) do not count against each other: send 21 `/go/wa` requests from the laptop and confirm the phone still gets 404, not 429.

### Headers and cookies
`next.config.ts` sends on every response: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment off) and, in production, `Strict-Transport-Security: max-age=31536000`. `X-Powered-By` is off.

The CSP allows only our own origin for scripts, styles, images, fonts and connections, forbids framing (`frame-ancestors 'none'`), `<object>` and a changed `<base>`, and lets forms go to us and `https://accounts.google.com` (Google sign-in). It has no nonce: the app uses Cache Components (partial prerendering), which Next.js documents as incompatible with nonces, so inline scripts and styles are allowed (`'unsafe-inline'`). If a new outside host is ever needed (an analytics script, a font CDN), add it to `lib/securityHeaders.ts`; the browser console shows `Refused to load …` when something is blocked.

Cookies are Auth.js's: with `AUTH_URL` on `https://…` the session cookie is `__Secure-authjs.session-token` and the CSRF cookie `__Host-authjs.csrf-token`, both `Secure`, `HttpOnly`, `SameSite=Lax` (`tests/securityHeaders.test.ts`). Keep `AUTH_URL` on the https address, or the cookies lose `Secure`. The sales filter cookie is `Secure` in production, `HttpOnly`, `SameSite=Lax`.

### Errors and logs
No paid monitoring. A failed request writes one line to the `web` log:

```
{"event":"request_error","name":"Error","digest":"2689830951","method":"GET","path":"/pipeline","routePath":"/pipeline","routeType":"render","at":"…"}
```

Our line holds no message, query string, headers or body (they can quote a customer's phone number). It is not the only output, though: Next.js itself still prints the original error, with its message, to stderr, so a message that quotes data could reach the Railway log. Keep error messages generic (never put a phone number, name or email in `throw new Error(...)`). The same `digest` is shown to the person on the error page as "Kode: …", so a report matches a line. Search it in Railway → `web` → Logs with `request_error`.

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
**Only the local drill has been run. Railway's own backup restore is NOT yet rehearsed; do it with the steps below before relying on it.** **Rehearsed here (local Postgres 16, `pg_dump -Fc` and `pg_restore` into a temporary database, 6 November 2026):** data as above, 4,9 MB dump. Dump 0,43 s, restore 0,61 s, no errors. Row counts equal in the source and the restored copy: users 11, contacts 8.000, leads 20.000, deals 3.000, deal_line_items 6.000, activities 40.000, schema_migrations 14. The real database is smaller than this, so expect seconds. Network time to Railway is extra.

```bash
docker exec fortu-pg psql -U postgres -c "CREATE DATABASE fortu_restore"
docker exec fortu-pg pg_dump -U postgres -d <source database> -Fc -f /tmp/drill.dump
time docker exec fortu-pg pg_restore -U postgres --no-owner --exit-on-error -d fortu_restore /tmp/drill.dump
# compare: select count(*) from users / contacts / leads / deals ... in both databases
docker exec fortu-pg psql -U postgres -c "DROP DATABASE fortu_restore"
```

**To rehearse on Railway (needs the dashboard, so it cannot be done from the repo). About 20 minutes, do it once before the review and note the times here:**

0. Once: `mkdir -p ~/fortu-backups`. The `pg_dump` and `pg_restore` on your computer must be the same major version as the Railway Postgres or newer (`pg_dump --version`; an older one refuses to dump a newer server).
1. Write down the time. Dashboard → `Postgres` → **Backups** → confirm last night's daily backup is listed (time and size).
2. Do **not** restore over the live database. Add a second Postgres: project canvas → **New** → **Database** → **PostgreSQL**; name it `postgres-drill`.
3. On `Postgres` → Backups, a backup can be restored in place only. So take the file route instead: on your computer, `railway run -s Postgres bash -c 'pg_dump "$DATABASE_PUBLIC_URL" -Fc -f ~/fortu-backups/drill.dump'` (this is a fresh dump of now; it proves the same path, and Railway's own backup is checked in step 1).
4. Restore it into the drill database: `railway run -s postgres-drill bash -c 'time pg_restore --no-owner --exit-on-error -d "$DATABASE_PUBLIC_URL" ~/fortu-backups/drill.dump'`. Write down the time. If it stops on an ownership or extension error that is only about roles Railway manages, run it again without `--exit-on-error` and read the messages: errors about `OWNER`, `GRANT` or `ROLE` are noise, anything about a table or data is not.
5. Compare counts on both: `railway run -s <service> bash -c 'psql "$DATABASE_PUBLIC_URL" -tAc "select (select count(*) from users), (select count(*) from contacts), (select count(*) from leads), (select count(*) from deals)"'`. They must match (a few more in the source if someone worked in between).
6. Optional, to prove the app works on it: set `DATABASE_URL` of a temporary `web` copy (or your laptop's `.env.local`) to the drill database and sign in.
7. Delete `postgres-drill` and `~/fortu-backups/drill.dump`.
8. Real emergency (data lost): `Postgres` → Backups → pick the last good backup → **Restore** (replaces the live data; everything after the backup is lost, so note the time first), then check `/api/health` and sign in.
