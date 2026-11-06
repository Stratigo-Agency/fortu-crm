// Review pack for the 3-week review with Pak Jovian (T23).
//
//   node scripts/review-pack.mjs [--from YYYY-MM-DD --to YYYY-MM-DD] [--out path] [--label "text"]
//
// Reads the database named by REVIEW_DATABASE_URL (or DATABASE_URL) and writes docs/review/2026-12-review.md.
// It only reads: one read-only transaction with SELECT queries. Use a read-only database user on production.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { isMain, root } from "./lib.mjs";
import { isDay, runQueries } from "./review-pack-queries.mjs";
import { renderReport } from "./review-pack-report.mjs";

export const DEFAULT_FROM = "2026-11-11"; // first day of the pilot
export const DEFAULT_TO = "2026-12-01"; // 21 days later, inclusive
export const DEFAULT_OUT = "docs/review/2026-12-review.md";

/** Reads --name value pairs. */
export function parseArgs(argv) {
  const opts = { from: DEFAULT_FROM, to: DEFAULT_TO, out: DEFAULT_OUT, label: "" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!["--from", "--to", "--out", "--label"].includes(key) || value === undefined) {
      throw new Error(`argumen tidak dikenal: ${key}. Pakai: --from YYYY-MM-DD --to YYYY-MM-DD [--out file] [--label teks]`);
    }
    opts[key.slice(2)] = value;
  }
  if (!isDay(opts.from) || !isDay(opts.to)) throw new Error("--from dan --to harus berformat YYYY-MM-DD");
  if (opts.from > opts.to) throw new Error("--from tidak boleh setelah --to");
  return opts;
}

/** host/database of a connection URL, without the password. */
function describeUrl(url) {
  const u = new URL(url);
  return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
}

const generatedAt = () =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date()) + " WIB";

export async function buildReview({ url, from, to, label }) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const results = await runQueries(sql, { from, to });
    return renderReport(results, { from, to, generatedAt: generatedAt(), banner: label || undefined });
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const url = process.env.REVIEW_DATABASE_URL || process.env.DATABASE_URL;
    if (!url) throw new Error("REVIEW_DATABASE_URL belum diisi (lihat docs/review/README.md)");
    console.error(`Membaca ${describeUrl(url)} untuk ${opts.from} sampai ${opts.to} (hanya baca)`);
    const text = await buildReview({ url, ...opts });
    const file = path.resolve(root, opts.out);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
    console.error(`Selesai: ${path.relative(root, file)}`);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
