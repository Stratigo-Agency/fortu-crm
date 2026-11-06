// Review pack for the 3-week review with Pak Jovian (T23).
//
//   node scripts/review-pack.mjs [--from YYYY-MM-DD --to YYYY-MM-DD] [--out path] [--label "text"] [--include-sample]
//
// Reads the database named by REVIEW_DATABASE_URL (or DATABASE_URL) and writes docs/review/2026-12-review.md.
// It only reads: one read-only transaction with SELECT queries. Use a read-only database user on production.
// Sample rows (is_sample = true) are left out unless --include-sample is given (only for the demo sample file).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { isMain, root } from "./lib.mjs";
import { isDay, runQueries } from "./review-pack-queries.mjs";
import { renderReport } from "./review-pack-report.mjs";

export const DEFAULT_FROM = "2026-11-11"; // first day of the pilot
export const DEFAULT_TO = "2026-12-01"; // 21 days later, inclusive
export const DEFAULT_OUT = "docs/review/2026-12-review.md";

/** Reads --name value pairs, and the --include-sample switch. */
export function parseArgs(argv) {
  const opts = { from: DEFAULT_FROM, to: DEFAULT_TO, out: DEFAULT_OUT, label: "", includeSample: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--include-sample") {
      opts.includeSample = true;
      continue;
    }
    const value = argv[i + 1];
    if (!["--from", "--to", "--out", "--label"].includes(key) || value === undefined) {
      throw new Error(`argumen tidak dikenal: ${key}. Pakai: --from YYYY-MM-DD --to YYYY-MM-DD [--out file] [--label teks] [--include-sample]`);
    }
    opts[key.slice(2)] = value;
    i += 1;
  }
  if (!isDay(opts.from) || !isDay(opts.to)) throw new Error("--from dan --to harus berformat YYYY-MM-DD");
  if (opts.from > opts.to) throw new Error("--from tidak boleh setelah --to");
  return opts;
}

/** Hides the user:password part of any connection URL inside a text (error messages must never show it). */
export function redact(text) {
  return String(text).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1***@");
}

/** host/database of a connection URL, without the user or the password. */
export function describeUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("alamat database tidak valid (cek REVIEW_DATABASE_URL)");
  }
  return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
}

const generatedAt = () =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date()) + " WIB";

export async function buildReview({ url, from, to, label, includeSample = false }) {
  const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 15 });
  try {
    const results = await runQueries(sql, { from, to, includeSample });
    return renderReport(results, { from, to, generatedAt: generatedAt(), banner: label || undefined, includeSample });
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
    console.error(`error: ${redact(err.message)}`);
    process.exit(1);
  }
}
