// Sends one signed test submission to the website form endpoint.
//   node scripts/sign-webform.mjs [--url http://localhost:3000/api/v1/ingest/web-form] [--phone 0812...] [--name "Budi"]
//        [--message "..."] [--product IFP] [--id <submission uuid>]
// Reads WEBFORM_HMAC_SECRET from the environment or from .env.local / .env. Prints the answer.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

function envFile() {
  for (const f of [".env.local", ".env"]) {
    try {
      const m = /^WEBFORM_HMAC_SECRET=(.*)$/m.exec(readFileSync(f, "utf8"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      /* file not there */
    }
  }
  return "";
}

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const secret = process.env.WEBFORM_HMAC_SECRET || envFile();
if (!secret) {
  console.error("WEBFORM_HMAC_SECRET is not set (environment, .env.local or .env).");
  process.exit(1);
}

const url = args.url ?? "http://localhost:3000/api/v1/ingest/web-form";
const body = JSON.stringify({
  submission_id: args.id ?? randomUUID(),
  submitted_at: new Date().toISOString(),
  name: args.name ?? "Uji Form Website",
  phone: args.phone ?? `0812${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
  email: "uji@example.com",
  company: "PT Uji Website",
  product_interest: args.product ?? "IFP",
  message: args.message ?? "Butuh 12 unit untuk kelas",
  page_url: "https://fortu.co.id/produk/ifp",
  utm: { source: "google", medium: "cpc", campaign: "ifp-sekolah", content: null },
  click_ids: { gclid: null, fbclid: null },
});
const ts = String(Math.floor(Date.now() / 1000));
const signature = `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-fortu-timestamp": ts, "x-fortu-signature": signature },
  body,
});
console.log(res.status, await res.text());
process.exit(res.ok ? 0 : 1);
