// Loads or removes the demo data (db/seeds/demo.sql). For staging and training only.
//   ALLOW_DEMO=1 node scripts/demo.mjs load     uses DATABASE_URL (refuses without ALLOW_DEMO=1, and
//                                               refuses a database that already holds real deals, prospects,
//                                               contacts or companies)
//   ... load --allow-real-data                  overrides that second check (docs/deploy.md, section 7)
//   node scripts/demo.mjs clear                 removes every demo row; safe on any database
//   (--test on either command uses DATABASE_URL_TEST instead of DATABASE_URL; see lib.mjs)
import path from "node:path";
import { connect, databaseUrl, isMain, root, runFile } from "./lib.mjs";

const DIR = path.join(root, "db/seeds");

/** Host and database of a connection URL, without the user or password. */
export function describeTarget(url) {
  const u = new URL(url);
  return `${u.hostname}${u.port ? `:${u.port}` : ""}/${decodeURIComponent(u.pathname.slice(1))}`;
}

/** Counts of rows that are not sample data. */
async function realRows(sql) {
  const [r] = await sql`
    SELECT (SELECT count(*) FROM deals WHERE NOT is_sample)::int AS deals,
           (SELECT count(*) FROM leads WHERE NOT is_sample)::int AS leads,
           (SELECT count(*) FROM contacts WHERE NOT is_sample)::int AS contacts,
           (SELECT count(*) FROM companies WHERE NOT is_sample)::int AS companies`;
  return r;
}

/** Real rows that still point at demo reps or DEMO- products, which would block the clean-up. */
async function realRowsUsingDemo(sql) {
  const [r] = await sql`
    SELECT (SELECT count(*) FROM deals d JOIN users u ON u.id = d.owner_user_id
             WHERE NOT d.is_sample AND u.email LIKE '%@demo.fortu.invalid')::int AS deals,
           (SELECT count(*) FROM leads l JOIN users u ON u.id = l.owner_user_id
             WHERE NOT l.is_sample AND u.email LIKE '%@demo.fortu.invalid')::int AS leads,
           (SELECT count(*) FROM deal_line_items li JOIN deals d ON d.id = li.deal_id JOIN products p ON p.id = li.product_id
             WHERE NOT d.is_sample AND p.sku LIKE 'DEMO-%')::int AS lines`;
  return r;
}

export async function runDemo(
  action,
  { url, allow = process.env.ALLOW_DEMO === "1", allowRealData = false, log = console.log },
) {
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
    if (action === "load" && !allowRealData) {
      const real = await realRows(sql);
      if (Object.values(real).some((n) => n > 0)) {
        throw new Error(
          `refusing to load demo data into ${target}: it already holds real data ` +
            `(${real.deals} deals, ${real.leads} prospects, ${real.contacts} contacts, ${real.companies} companies). ` +
            "Demo data goes into an empty staging database. If you are sure, add --allow-real-data.",
        );
      }
    }
    const used = await realRowsUsingDemo(sql);
    if (used.deals + used.leads + used.lines > 0) {
      throw new Error(
        `cannot remove the demo data from ${target}: real rows still use it ` +
          `(${used.deals} deals and ${used.leads} prospects owned by a demo rep, ${used.lines} product lines with a DEMO- product). ` +
          "Reassign them or change their product first. Nothing was changed.",
      );
    }
    try {
      await sql.begin(async (tx) => {
        await runFile(tx, DIR, "demo.clear.sql");
        if (action === "load") await runFile(tx, DIR, "demo.sql");
      });
    } catch (err) {
      if (err.code === "23503") {
        throw new Error(`cannot remove the demo data: a real row still points at it (${err.detail ?? err.message}). Nothing was changed.`);
      }
      throw err;
    }
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
    await runDemo(process.argv[2], { url: databaseUrl(), allowRealData: process.argv.includes("--allow-real-data") });
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
