import { execFileSync } from "node:child_process";
import postgres from "postgres";

export const REP = { email: "rep@e2e.example.com", password: "e2e-rep-password-1", name: "Rep E2E" };
export const AD = { code: "F-IFP-01", name: "IFP Sekolah" };

// Playwright loads this file as CommonJS, so the ES-module scripts run in their own Node process.
function node(args: string[], env: Record<string, string> = {}) {
  return execFileSync(process.execPath, args, {
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

// A fresh e2e database with one rep who can sign in, and one ad with a prefill code.
export default async function globalSetup() {
  const url = process.env.DATABASE_URL_E2E as string;
  node(["scripts/test-db-reset.mjs"], { DATABASE_URL_TEST: url });
  const hash = node(
    ["--input-type=module", "-e", 'import { hashPassword } from "./lib/password.mjs"; console.log(await hashPassword(process.argv[1]))', REP.password],
  );
  const sql = postgres(url, { max: 1 });
  try {
    await sql`
      INSERT INTO users (full_name, email, role, password_hash)
      VALUES (${REP.name}, ${REP.email}, 'sales_rep', ${hash})`;
    await sql`
      WITH c AS (INSERT INTO ad_campaigns (meta_campaign_id, name) VALUES ('c-e2e', 'Kampanye e2e') RETURNING id),
           s AS (INSERT INTO ad_sets (meta_adset_id, campaign_id, name) SELECT 's-e2e', id, 'Set e2e' FROM c RETURNING id)
      INSERT INTO ads (meta_ad_id, ad_set_id, name, prefill_code)
      SELECT 'a-e2e', id, ${AD.name}, ${AD.code} FROM s`;
  } finally {
    await sql.end();
  }
}
