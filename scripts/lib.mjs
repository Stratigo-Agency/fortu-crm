// Shared by the database scripts (migrate, seed, test-db-reset).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

export const root = path.resolve(import.meta.dirname, "..");

/** DATABASE_URL, or DATABASE_URL_TEST when the script runs with --test. */
export function databaseUrl(argv = process.argv) {
  const key = argv.includes("--test") ? "DATABASE_URL_TEST" : "DATABASE_URL";
  const url = process.env[key];
  if (!url) throw new Error(`${key} is not set (copy .env.example to .env.local)`);
  return url;
}

/** One connection, so session state (advisory locks) stays on it. */
export function connect(url) {
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** *.sql files in a directory, sorted by name. */
export async function sqlFiles(dir) {
  const names = await readdir(dir);
  return names.filter((n) => n.endsWith(".sql")).sort();
}

/** Run a whole .sql file as one simple-protocol query inside the given transaction. */
export async function runFile(tx, dir, file) {
  const text = await readFile(path.join(dir, file), "utf8");
  try {
    await tx.unsafe(text).simple();
  } catch (err) {
    err.message = describeError(err, text);
    throw err;
  }
}

function describeError(err, text) {
  const parts = [err.message];
  if (err.position) {
    const line = text.slice(0, Number(err.position)).split("\n").length;
    parts.push(`(line ${line})`);
  }
  if (err.detail) parts.push(`detail: ${err.detail}`);
  if (err.hint) parts.push(`hint: ${err.hint}`);
  if (err.where) parts.push(`where: ${err.where}`);
  return parts.join(" · ");
}
