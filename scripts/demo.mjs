// Loads or removes the demo data (db/seeds/demo.sql). For staging and training only.
//   ALLOW_DEMO=1 node scripts/demo.mjs load     uses DATABASE_URL (refuses without ALLOW_DEMO=1)
//   node scripts/demo.mjs clear                 removes every demo row; safe on any database
//   node scripts/demo.mjs load --test           uses DATABASE_URL_TEST
import path from "node:path";
import { connect, databaseUrl, isMain, root, runFile } from "./lib.mjs";

const DIR = path.join(root, "db/seeds");

/** Host and database of a connection URL, without the user or password. */
export function describeTarget(url) {
  const u = new URL(url);
  return `${u.hostname}${u.port ? `:${u.port}` : ""}/${decodeURIComponent(u.pathname.slice(1))}`;
}

export async function runDemo(action, { url, allow = process.env.ALLOW_DEMO === "1", log = console.log }) {
  if (action !== "load" && action !== "clear") throw new Error('use "load" or "clear"');
  const target = describeTarget(url);
  log(`database: ${target}`);
  if (action === "load" && !allow) {
    throw new Error(
      `refusing to load demo data into ${target}. Demo data is for staging and training only; ` +
        "run with ALLOW_DEMO=1 if this is not production.",
    );
  }
  const sql = connect(url);
  try {
    await sql.begin(async (tx) => {
      await runFile(tx, DIR, "demo.clear.sql");
      if (action === "load") await runFile(tx, DIR, "demo.sql");
    });
    const [{ deals, leads }] = await sql`
      SELECT (SELECT count(*) FROM deals WHERE is_sample)::int AS deals,
             (SELECT count(*) FROM leads WHERE is_sample)::int AS leads`;
    log(`${action === "load" ? "demo data loaded" : "demo data removed"}: ${deals} sample deals, ${leads} sample prospects`);
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta)) {
  try {
    await runDemo(process.argv[2], { url: databaseUrl() });
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
