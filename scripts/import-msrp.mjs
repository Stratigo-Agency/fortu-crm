// Loads the MSRP list into products: list_price and the per-SKU discount limit.
//   node scripts/import-msrp.mjs path/to/msrp.csv             writes to DATABASE_URL
//   node scripts/import-msrp.mjs path/to/msrp.csv --dry-run   shows what would change, writes nothing
// The file is semicolon separated, one header row: sku;msrp;max_discount_pct
//   IFP-86;85000000;15       MSRP in whole Rupiah before PPN; the limit in percent
//   IFP-75;62500000;         empty limit = use the app setting
// Rows with a bad number stop the whole import (nothing is written). SKUs that are not in products are
// listed and skipped. The real price list is supplied by Pak Jovian and is never committed to the repo.
import { readFile } from "node:fs/promises";
import { connect, databaseUrl, isMain } from "./lib.mjs";

const HEADER = ["sku", "msrp", "max_discount_pct"];

/** "85000000", "85.000.000" and "Rp85.000.000" are all whole Rupiah; anything else is not. */
function parseRupiah(raw) {
  const s = raw.replace(/^rp\s*/i, "").replace(/[.\s]/g, "");
  return /^\d+$/.test(s) && Number(s) > 0 && Number.isSafeInteger(Number(s)) ? Number(s) : null;
}

/** "15", "12,5" or "12.5": a percent from 0 to 100. Empty means no own limit (null). */
function parsePercent(raw) {
  const s = raw.replace("%", "").replace(",", ".").trim();
  if (s === "") return { value: null };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s) || Number(s) > 100) return null;
  return { value: Number(s) };
}

/** Reads the CSV text into rows, or lists every problem (line numbers start at 1 with the header). */
export function parseMsrpCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const errors = [];
  const rows = [];
  if (lines.length === 0) return { rows, errors: ["the file is empty"] };
  const head = lines[0].split(";").map((h) => h.trim().toLowerCase());
  if (head.length !== 3 || HEADER.some((h, i) => head[i] !== h)) {
    return { rows, errors: [`line 1: the header must be ${HEADER.join(";")}`] };
  }
  const seen = new Set();
  lines.slice(1).forEach((line, i) => {
    const n = i + 2;
    const cells = line.split(";").map((c) => c.trim());
    if (cells.length !== 3) return void errors.push(`line ${n}: expected 3 columns separated by ;`);
    const [sku, msrpRaw, pctRaw] = cells;
    if (!sku) return void errors.push(`line ${n}: sku is empty`);
    if (seen.has(sku)) return void errors.push(`line ${n}: sku ${sku} appears twice`);
    seen.add(sku);
    const msrp = parseRupiah(msrpRaw);
    if (msrp === null) return void errors.push(`line ${n}: msrp "${msrpRaw}" must be a whole Rupiah amount above 0`);
    const pct = parsePercent(pctRaw);
    if (pct === null) return void errors.push(`line ${n}: max_discount_pct "${pctRaw}" must be 0 to 100 or empty`);
    rows.push({ sku, msrp, maxDiscountPct: pct.value });
  });
  return { rows, errors };
}

/**
 * Applies the rows. Returns { updated, unchanged, unknown } (SKU lists/counts); with dryRun nothing is written.
 * Throws an Error listing the problems when the file is not valid.
 */
export async function importMsrp({ url, file, dryRun = false, log = console.log }) {
  const { rows, errors } = parseMsrpCsv(await readFile(file, "utf8"));
  if (errors.length) throw new Error(`${file} is not valid, nothing was changed:\n  ${errors.join("\n  ")}`);

  const sql = connect(url);
  try {
    return await sql.begin(async (tx) => {
      const known = await tx`SELECT sku, list_price::bigint AS list_price, max_discount_pct::float8 AS max_discount_pct
                               FROM products WHERE sku IN ${tx(rows.map((r) => r.sku))}`;
      const bySku = new Map(known.map((p) => [p.sku, p]));
      const unknown = rows.filter((r) => !bySku.has(r.sku)).map((r) => r.sku);
      let updated = 0;
      let unchanged = 0;
      for (const r of rows) {
        const p = bySku.get(r.sku);
        if (!p) continue;
        if (Number(p.list_price) === r.msrp && p.max_discount_pct === r.maxDiscountPct) {
          unchanged++;
          continue;
        }
        log(`${dryRun ? "would set" : "set"} ${r.sku}: msrp ${p.list_price ?? "-"} -> ${r.msrp}, limit ${p.max_discount_pct ?? "default"} -> ${r.maxDiscountPct ?? "default"}`);
        if (!dryRun) {
          await tx`UPDATE products SET list_price = ${r.msrp}, max_discount_pct = ${r.maxDiscountPct} WHERE sku = ${r.sku}`;
        }
        updated++;
      }
      if (unknown.length) log(`unknown SKU (not in products, skipped): ${unknown.join(", ")}`);
      log(`${dryRun ? "dry run: nothing written. " : ""}${updated} ${dryRun ? "would change" : "changed"}, ${unchanged} already up to date, ${unknown.length} unknown`);
      return { updated, unchanged, unknown };
    });
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta)) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node scripts/import-msrp.mjs <msrp.csv> [--dry-run]");
    process.exit(1);
  }
  try {
    await importMsrp({ url: databaseUrl(), file, dryRun });
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
