# Deploy on Railway

One Railway project, one repo, several services. Every service builds with `npm run build` (this also compiles `jobs/*.ts` to `jobs/*.js`).

| Service | Start command | Schedule |
| --- | --- | --- |
| `web` | `npm start` | always on (railway.json also runs `npm run db:migrate` before each deploy) |
| `postgres` | Railway Postgres plugin | always on |
| `cron-insights` | `node jobs/insights-sync.js` | `0 19 * * *` (19:00 UTC = 02:00 Jakarta) |
| `cron-sweeper` | `node jobs/sweeper.js` | `0 1-13 * * *` (01:00–13:00 UTC = 08:00–20:00 Jakarta, every hour) |
| `cron-accurate` | `node jobs/accurate-sync.js` | `0 18 * * *` (18:00 UTC = 01:00 Jakarta) |

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

## Variables on `web`
See `.env.example`. Meta variables are only needed on `cron-insights` until the WhatsApp Cloud API webhook (T19).
