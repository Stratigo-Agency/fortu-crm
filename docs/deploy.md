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
2. `web` → Settings → Source: branch `main`. Turn on **Wait for CI** if the repo has checks.
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

`META_*` and `SMTP_*` belong to the cron services (sections below), not to `web`. Do not set `DATABASE_URL_TEST`, `E2E` or `NEXT_DIST_DIR` here.

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

Check `railway status` first: it must say environment `staging`. The script also prints `database: <host>/<name>` before it changes anything. It adds 4 demo reps (`@demo.fortu.invalid`), 25 deals and 6 prospects, all marked sample. Running it again resets the demo rows.

Remove it (safe on any database, it only touches rows marked sample):

```bash
railway run -s Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npm run db:demo:clear'
```

**Never run `db:demo` against production.** The script refuses without `ALLOW_DEMO=1`, so do not put that variable in a Railway service or in `.env.local`.

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

The two cron services are added after `web` works. Each has its own section below.

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
