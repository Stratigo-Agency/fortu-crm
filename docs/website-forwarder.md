# Website → CRM: what the website team needs

1. **Form leads.** After a visitor submits the form, send the lead with `docs/fastapi_forwarder.py` (`forward_lead`), as a FastAPI background task. It signs the request and retries on errors.
2. **Env vars** on the FastAPI service: `CRM_INGEST_URL` (the CRM's `/api/v1/ingest/web-form`) and `WEBFORM_HMAC_SECRET` (the same value as the CRM). Keep the secret on the server only.
3. **One `submission_id` per submission.** Make it once and keep it for the retries. The CRM answers 200 (`deduped: true`) to one it already has.
4. **Send what you have.** Only `submission_id` and `phone` are required. Add `utm` and `click_ids` read from the landing URL (store them in `sessionStorage` on first load) so the lead shows where it came from.
5. **Answers.** 200 saved · 400 body is wrong (e.g. phone unreadable), don't retry · 401 signature or clock is wrong, don't retry · 429 too many requests, wait `Retry-After` seconds and retry · 5xx retry.
6. **WhatsApp buttons.** Link them to `https://<crm-host>/go/wa?line=<line name>` instead of `wa.me`. Add `&utm_source=…&utm_campaign=…` and optionally `&text=<message>`. The CRM adds a code like `#W7K2` to the message and sends the visitor to WhatsApp.
7. **Test it.** From a computer with the secret: `node scripts/sign-webform.mjs --url <CRM_INGEST_URL>`.
