# Integrations and contracts

Technical extract of the "Fortu CRM — Architecture Blueprint" (Phase 2), so Claude Code has it in the repo.
Stage names follow migration 004 (Chat masuk … Done deal). If this file and a migration disagree, the migration wins.

## Entry points
| Door | Shape | Auth | Writes | When |
| --- | --- | --- | --- | --- |
| Rep quick-add | Server Action `createLead()` | rep session | contacts, leads, activities | MVP |
| Screens (qualify, move stage, lines, activity, reassign) | Server Actions `qualifyLead()`, `moveDealStage()`, `saveLineItems()`, `logActivity()`, `reassign()` | session + `can_edit_*` | deals, deal_line_items, activities, ownership_changes (stage history by trigger) | MVP |
| fortu.co.id form (Vue SPA → FastAPI) | `POST /api/v1/ingest/web-form`, server-to-server | HMAC-SHA256 over `timestamp.body` in `X-Fortu-Signature`, `X-Fortu-Timestamp` within 300 s | inbound_events → leads (`web_form`, `pick_lead_owner()`) | MVP |
| Tracked WhatsApp link (website buttons, Google Ads, IG bio) | `GET /go/wa?line=<label>&utm_source=…` | public, rate-limited | wa_click_events, then 302 to `wa.me/<number>?text=<prefill> #W7K2` | MVP |
| WhatsApp Cloud API / Coexistence | `GET` + `POST /api/v1/webhooks/whatsapp` | verify token (GET); `X-Hub-Signature-256` with the Meta app secret (POST) | inbound_events → leads (`cloud_api_webhook`), activities | later (T19) |
| Meta Marketing API | Railway cron `insights-sync`, 02:00 WIB | system-user token, `ads_read` | ad_campaigns, ad_sets, ads, ad_insights_daily | T13 |
| Stale deals, reminders | Railway cron `sweeper`, hourly 08:00–20:00 WIB | internal | notifications | T16 |
| Accurate.id | Railway cron `cron-accurate`, 01:00 WIB, read-only | Accurate API token | products, inventory_snapshots, purchase_orders, sales_monthly | T20 |

Screens read Postgres in Server Components. Only outside systems get HTTP routes, all under `/api/v1/` (plus `/go/wa`).

## One ingestion function: `ingestLead()`
```ts
type LeadInput = {
  phone: string;                 // any format; normalised to E.164
  name?: string;
  company?: string;
  sourceChannel: SourceChannel;  // meta_ctwa | website_form | google_ads | ...
  captureMethod: CaptureMethod;  // manual_quick_add | web_form | wa_link_ref | cloud_api_webhook
  waLineId?: string;             // quick-add: the rep's own line
  firstMessage?: string;         // scanned for [F-IFP-01] and #W7K2 codes
  productInterest?: 'IFP' | 'DSS' | 'LED';
  utm?: Partial<Record<'source' | 'medium' | 'campaign' | 'content', string>>;
  receivedAt?: string;           // ISO 8601; defaults to now
  external?: { provider: 'whatsapp' | 'web_form'; id: string; payload: unknown };
};

type LeadResult = { leadId: string; contactId: string; ownerId: string;
                    deduped: boolean; adId?: string;
                    ownerConflict?: { contactName: string; repName: string } };
```
One transaction, in this order:
1. **Idempotency.** If `external` is set, insert into `inbound_events` with `ON CONFLICT (provider, external_id) DO NOTHING`. Nothing inserted = the sender is retrying: return the existing lead.
2. **Normalise the phone.** Digits only; `08…`, `8…`, `628…` → `+628…`. Reject anything the `contacts.phone_e164` check refuses.
3. **Upsert the contact** on `phone_e164`, filling name and company only where empty.
4. **Resolve the owner.** No customer is locked to a rep. Quick-add → the rep who logged it (the chat is on their phone). No line → `pick_lead_owner(product_interest)`: active reps with `accepting_leads` whose `product_lines` cover it, fewest open new leads first, then whoever was assigned longest ago. If the contact has an open deal with another rep, return `ownerConflict` so the UI shows it. Every assignment writes `ownership_changes`.
5. **Attribution.** `[F-IFP-01]` in the message → `ads.prefill_code`. `#W7K2` → `wa_click_events.ref_code` (copy its UTMs, set `matched_lead_id`). On Cloud API, `referral.source_id` → `ads.meta_ad_id`, which beats both.
6. **Dedupe window.** Same contact with a `new` lead on the same line in the last 24 h → add an activity to it instead of a second lead; return `deduped: true`.
7. **Write** the lead and a `system` activity (metadata: via, code), then return.

Reassigning a WhatsApp lead on the phone app is a handoff: the new rep messages the customer from their own number; the CRM logs an activity.

## Attribution codes
| Code | Example | Set by | Lives in |
| --- | --- | --- | --- |
| Ad code | `[F-IFP-01]` = rep initial · product line · number | Nabil, once per ad, in the Click-to-WhatsApp prefilled message | `ads.prefill_code` |
| Click code | `#W7K2` = 4 random characters | `/go/wa`, one per click | `wa_click_events.ref_code` |

The rep pastes the customer's first message into Tambah cepat and the code fills the source. Customers can delete the prefilled text, so some leads arrive without a code; source is then picked by hand.

## Website form: FastAPI → CRM
FastAPI calls the ingest endpoint; it never writes to the CRM database. There is no `leads_inbox` table: the inbox is `leads` where `status = 'new'`.

Body (`submission_id` is a UUID generated once per submission = idempotency key):
```json
{
  "submission_id": "0b6e2f1c-6d0a-4c39-9a7e-2f4f5c0d9e11",
  "submitted_at": "2026-11-03T10:15:00+07:00",
  "name": "Budi Santoso",
  "phone": "0812-3456-7890",
  "email": "budi@sma1.sch.id",
  "company": "SMA Negeri 1",
  "product_interest": "IFP",
  "message": "Butuh 12 unit untuk kelas",
  "page_url": "https://fortu.co.id/produk/ifp",
  "utm": { "source": "google", "medium": "cpc", "campaign": "ifp-sekolah", "content": null },
  "click_ids": { "gclid": "Cj0KCQ…", "fbclid": null }
}
```
Signing on the FastAPI side (goes to `docs/fastapi_forwarder.py`):
```python
import hashlib, hmac, json, os, time
import httpx

CRM_URL = os.environ["CRM_INGEST_URL"]        # https://<crm-host>/api/v1/ingest/web-form
SECRET = os.environ["WEBFORM_HMAC_SECRET"].encode()

async def forward_lead(payload: dict) -> None:
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    ts = str(int(time.time()))
    sig = hmac.new(SECRET, ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(CRM_URL, content=body, headers={
            "Content-Type": "application/json",
            "X-Fortu-Timestamp": ts,
            "X-Fortu-Signature": f"sha256={sig}",
        })
        r.raise_for_status()
```
- Send as a FastAPI background task. Retry on 5xx with the same `submission_id`; the CRM answers 200 to a duplicate.
- The CRM route reads the raw body, recomputes the HMAC over `timestamp.body`, compares with `timingSafeEqual`, rejects a timestamp more than 300 s off.
- The Vue SPA stores `utm_*`, `gclid`, `fbclid` from the landing URL in `sessionStorage` on first load and sends them with the form.
- In the same Railway project, FastAPI can call the CRM over the private network.

## WhatsApp Cloud API webhook (T19)
Moving a line = fill `wa_lines.meta_phone_number_id`, flip `mode`, subscribe the app to `messages`.
| Webhook field (`entry[].changes[].value`) | Goes to |
| --- | --- |
| `metadata.phone_number_id` | `wa_lines` lookup → `waLineId`, owner |
| `contacts[0].wa_id`, `contacts[0].profile.name` | `phone`, `name` |
| `messages[0].id` | `external.id` (idempotency) |
| `messages[0].timestamp` | `receivedAt` |
| `messages[0].text.body` | `firstMessage` |
| `messages[0].referral.source_id`, `.source_type = ad`, `.ctwa_clid`, `.headline` | `adId`, `leads.ctwa_clid`, activity note |

The POST handler verifies the signature, writes `inbound_events`, returns 200; processing runs right after in the same request. A retry job picks up rows with `processed_at` null. With Coexistence, Meta also sends echoes of replies typed in the phone app; if confirmed, `first_response_at` fills itself and the 15-minute SLA becomes measurable.

## Meta insights sync (T13)
```http
GET https://graph.facebook.com/<version>/act_<AD_ACCOUNT_ID>/insights
  ?level=ad&time_increment=1
  &time_range={"since":"<today-3>","until":"<yesterday>"}
  &fields=campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,actions
```
- Re-pull the last 3 days every night, upsert on (`ad_id`, `date`). Meta restates recent figures.
- Conversations = `actions` where `action_type` is `onsite_conversion.messaging_conversation_started_7d`.
- Owner and product line are set once per campaign / ad set in `/pengaturan/iklan` (naming convention: `No_Frisca`, `Frisca - IFP`), not parsed on every run.

## Alerts (T16)
Reminders go to the deal's owner only, about their own work. Pak Jovian (CEO) asked for no alerts about
deals (big, stuck, won, discounted): nobody is notified about someone else's deal. Discounts waiting for
approval are listed in Laporan · Perlu perhatian with the approve button; that is a list, not a push.

| Kind | Condition | To | Channel |
| --- | --- | --- | --- |
| `stale_deal` | deal ≥ `app_settings.high_value_amount` (Rp100 jt) past its stage's `stale_after_days` | owner | in-app + email |
| `next_step_overdue` (004) | `next_step_date` before today | owner, once a day | in-app + email |
| `sla_breach` | lead not answered in 15 min (Cloud API lines only) | owner | in-app |

Not sent any more (the enum values stay so old rows still read): `high_value_lead`, `won`, `discount_approval`.

One payload for every channel (numbers illustrative). Dedupe on (`kind`, `deal_id`, Jakarta day).
```json
{
  "kind": "stale_deal",
  "occurred_at": "2026-11-03T10:15:00+07:00",
  "deal": {
    "id": "8f0c…", "name": "SMA Negeri 1 · 12× IFP 75\"",
    "amount": 540000000, "stage": "Chat masuk", "probability": 0.10,
    "weighted_amount": 54000000, "expected_close_date": "2026-12-15",
    "product_lines": ["IFP"], "url": "https://<crm-host>/deals/8f0c…"
  },
  "owner": { "id": "…", "name": "Frisca" },
  "contact": { "name": "Budi", "company": "SMA Negeri 1", "industry": "education" },
  "source": { "channel": "meta_ctwa", "ad": "Vid Interactive Smartboard - Frisca",
              "capture_method": "manual_quick_add" }
}
```

## Sign-in (T02)
- Gate = an active `users` row, not the email domain. Hostinger mailboxes are not Google accounts; people create a Google account on their work address ("use my current email address").
- Check `email` and `email_verified`, never `hd` (Hostinger addresses never carry it).
- An admin adds people; nobody self-registers. No shared logins (`sales@`, `demo@`, `partnership@` are not users). No password fallback.
```ts
// auth.ts · Auth.js v5
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { sql } from '@/lib/db';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    async signIn({ profile }) {
      if (!profile?.email || profile.email_verified !== true) return false;
      const rows = await sql`
        UPDATE users
           SET google_sub = COALESCE(google_sub, ${profile.sub}), last_login_at = now()
         WHERE lower(email) = lower(${profile.email})
           AND is_active
           AND (google_sub IS NULL OR google_sub = ${profile.sub})
        RETURNING id`;
      return rows.length === 1;
    },
  },
});
```
The first sign-in binds the Google `sub`; a different `sub` for the same email is refused later. The session callback adds `id`, `role`, `full_name` from `users`.

## Railway layout (T12)
| Service | Runs | Notes |
| --- | --- | --- |
| `web` | Next.js: screens, Server Actions, `/api/v1/*`, `/go/wa` | always on; region nearest Jakarta |
| `postgres` | Railway PostgreSQL | daily backups; `DATABASE_URL` shared by reference |
| `cron-insights` | `node jobs/insights-sync.js` | `0 19 * * *` (02:00 WIB) |
| `cron-sweeper` | `node jobs/sweeper.js` | `0 1-13 * * *` (08:00–20:00 WIB) |
