# Deploy on Railway

One Railway project, one repo, several services. Every service builds with `npm run build` (this also compiles `jobs/*.ts` to `jobs/*.js`).

| Service | Start command | Schedule |
| --- | --- | --- |
| `web` | `npm start` | always on (railway.json also runs `npm run db:migrate` before each deploy) |
| `postgres` | Railway Postgres plugin | always on |
| `cron-insights` | `node jobs/insights-sync.js` | `0 19 * * *` (19:00 UTC = 02:00 Jakarta) |
| `cron-sweeper` | later (T16) | later |

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

## Variables on `web`
See `.env.example`. Meta variables are only needed on `cron-insights` until the WhatsApp Cloud API webhook (T19).
