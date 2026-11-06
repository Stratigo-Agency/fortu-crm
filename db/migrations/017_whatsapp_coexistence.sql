-- 017 · WhatsApp Coexistence spike (T19, MAR-158, 6 Nov 2026)
--
-- A rep's WhatsApp Business app number connected to the Cloud API (Coexistence) sends the CRM a webhook for each
-- chat. What we keep, and why (docs/whatsapp-coexistence.md):
--   * consent: a line is processed only after the rep agreed in writing (consent_at / consent_by);
--   * metadata of every message (direction, time, type, WhatsApp id), so first-response times can be measured;
--   * message text only when the line's store_message_text is on (off by default), in its own table, readable by
--     the line owner, ceo and admin only (lib/whatsapp/texts.ts).
-- Numbered 017 on purpose: an open pull request uses 016.

ALTER TABLE wa_lines
  ADD COLUMN consent_at              timestamptz,
  ADD COLUMN consent_by              text,          -- the name of the rep who agreed, as written on the form
  ADD COLUMN consent_recorded_by     uuid REFERENCES users(id),
  ADD COLUMN store_message_text      boolean NOT NULL DEFAULT false,
  ADD COLUMN meta_business_token_enc text,          -- AES-256-GCM (lib/whatsapp/secretBox.ts); never sent to a browser
  ADD COLUMN contacts_sync_request_id text,
  ADD COLUMN history_sync_request_id  text,
  ADD COLUMN last_event_at           timestamptz,
  ADD CONSTRAINT wa_lines_consent_named CHECK (consent_at IS NULL OR length(trim(consent_by)) > 0);

-- Retries of webhook events: how often a row was tried, and a fast lookup of the ones still waiting.
ALTER TABLE inbound_events ADD COLUMN attempts smallint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS inbound_events_unprocessed_idx ON inbound_events (received_at) WHERE processed_at IS NULL;

-- A WhatsApp user as Meta names them on one line: the business-scoped user id (BSUID) always, the phone number
-- (wa_id) only while the user has no username. Lets a later message without a phone number find its contact.
CREATE TABLE wa_contacts (
  wa_line_id   uuid NOT NULL REFERENCES wa_lines(id),
  bsuid        text NOT NULL,
  wa_id        text,
  contact_id   uuid REFERENCES contacts(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wa_line_id, bsuid)
);

-- One row per WhatsApp message seen on a line. Metadata only: no text here.
CREATE TABLE wa_messages (
  id             bigserial PRIMARY KEY,
  wa_line_id     uuid NOT NULL REFERENCES wa_lines(id),
  wa_message_id  text NOT NULL,                  -- wamid.…
  direction      text NOT NULL CHECK (direction IN ('in', 'out')),
  source         text NOT NULL CHECK (source IN ('messages', 'echo', 'history')),
  msg_type       text NOT NULL,
  sent_at        timestamptz NOT NULL,
  peer_bsuid     text,
  contact_id     uuid REFERENCES contacts(id),
  lead_id        uuid REFERENCES leads(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wa_line_id, wa_message_id)
);
CREATE INDEX wa_messages_lead_idx ON wa_messages (lead_id, sent_at);
CREATE INDEX wa_messages_contact_idx ON wa_messages (contact_id, sent_at);

-- Message text, only for lines with store_message_text on. Kept apart so it is never joined by accident.
CREATE TABLE wa_message_texts (
  message_id  bigint PRIMARY KEY REFERENCES wa_messages(id) ON DELETE CASCADE,
  body        text NOT NULL
);

-- Response times per rep for leads that came in by webhook (the only ones with a reliable first_response_at),
-- last 30 days. A share counts only leads old enough to have had the chance (15 min / 1 h).
CREATE VIEW v_wa_response_times AS
WITH l AS (
  SELECT l.owner_user_id, l.received_at, l.first_response_at, l.status,
         extract(epoch FROM l.first_response_at - l.received_at) / 60 AS minutes
    FROM leads l
   WHERE l.capture_method = 'cloud_api_webhook'
     AND NOT l.is_sample
     AND l.owner_user_id IS NOT NULL
     AND l.received_at >= now() - interval '30 days'
)
SELECT owner_user_id,
       count(*)::int AS leads,
       count(first_response_at)::int AS answered,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes))::numeric, 1) AS median_first_response_min,
       round(100.0 * count(*) FILTER (WHERE minutes <= 15)
             / NULLIF(count(*) FILTER (WHERE first_response_at IS NOT NULL OR received_at < now() - interval '15 minutes'), 0))::int
         AS pct_within_15m,
       round(100.0 * count(*) FILTER (WHERE minutes <= 60)
             / NULLIF(count(*) FILTER (WHERE first_response_at IS NOT NULL OR received_at < now() - interval '1 hour'), 0))::int
         AS pct_within_1h,
       count(*) FILTER (WHERE first_response_at IS NULL AND status = 'new'
                          AND received_at < now() - interval '2 hours')::int AS unanswered_over_2h
  FROM l
 GROUP BY owner_user_id;
