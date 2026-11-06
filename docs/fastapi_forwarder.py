"""Forwards a website form submission to the Fortu CRM.

For the website team (FastAPI backend of fortu.co.id). The CRM never reads the website database, and the
website never writes to the CRM database: this one signed POST is the whole contract.

Environment variables
  CRM_INGEST_URL        https://<crm-host>/api/v1/ingest/web-form   (in the same Railway project: the private URL)
  WEBFORM_HMAC_SECRET   the same secret the CRM has; never send it to the browser

Usage
  @app.post("/api/contact")
  async def contact(form: ContactForm, tasks: BackgroundTasks):
      payload = build_payload(form, utm=..., click_ids=...)   # submission_id is made ONCE here
      tasks.add_task(forward_lead, payload)
      return {"ok": True}

Rules
  - Make `submission_id` (a UUID) once per submission and reuse it on every retry. The CRM answers 200 to a
    submission it already has, so a retry never makes a second lead.
  - Retry on a network error, a 5xx answer or 429 (3 tries, growing wait; on 429 wait as long as Retry-After says).
    Do not retry any other 4xx: 400 means the body is
    wrong (e.g. an unreadable phone number) and 401 means the signature or the clock is wrong.
  - Sign the exact bytes you send. Build the JSON text once, sign it, and send that same text.
  - Keep the server clock correct: a request more than 300 seconds off is refused with 401.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone

import httpx

log = logging.getLogger("crm_forwarder")

CRM_URL = os.environ["CRM_INGEST_URL"]
SECRET = os.environ["WEBFORM_HMAC_SECRET"].encode()
RETRIES = 3


def build_payload(form: dict, utm: dict | None = None, click_ids: dict | None = None) -> dict:
    """The body the CRM expects. `form` has name, phone, email, company, product_interest, message, page_url."""
    return {
        "submission_id": str(uuid.uuid4()),
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "name": form.get("name"),
        "phone": form["phone"],
        "email": form.get("email"),
        "company": form.get("company"),
        "product_interest": form.get("product_interest"),  # "IFP", "DSS" or "LED"
        "message": form.get("message"),
        "page_url": form.get("page_url"),
        "utm": utm or {"source": None, "medium": None, "campaign": None, "content": None},
        "click_ids": click_ids or {"gclid": None, "fbclid": None},
    }


async def forward_lead(payload: dict) -> None:
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    async with httpx.AsyncClient(timeout=10) as client:
        for attempt in range(1, RETRIES + 1):
            ts = str(int(time.time()))  # signed fresh on each try, the body and submission_id stay the same
            sig = hmac.new(SECRET, ts.encode() + b"." + body, hashlib.sha256).hexdigest()
            try:
                r = await client.post(
                    CRM_URL,
                    content=body,
                    headers={
                        "Content-Type": "application/json",
                        "X-Fortu-Timestamp": ts,
                        "X-Fortu-Signature": f"sha256={sig}",
                    },
                )
            except httpx.TransportError as exc:
                log.warning("CRM not reachable (try %s/%s): %s", attempt, RETRIES, exc)
            else:
                if r.status_code < 400:
                    return
                if r.status_code == 429:
                    log.warning("CRM rate limited (try %s/%s)", attempt, RETRIES)
                    if attempt < RETRIES:
                        await asyncio.sleep(min(int(r.headers.get("Retry-After", "60") or 60), 120))
                    continue
                if r.status_code < 500:
                    log.error("CRM refused the lead (%s): %s", r.status_code, r.text[:200])
                    return  # 4xx: retrying the same body cannot help
                log.warning("CRM error %s (try %s/%s)", r.status_code, attempt, RETRIES)
            if attempt < RETRIES:
                await asyncio.sleep(2**attempt)
    log.error("CRM did not accept submission %s after %s tries", payload["submission_id"], RETRIES)
