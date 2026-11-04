import postgres from "postgres";

// One client per process. In dev, hot reloads re-evaluate this module, so the
// client is kept on globalThis instead of opening a new pool each time.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

// numeric and bigint come back as strings (postgres.js default): money stays exact.
export const sql =
  globalForDb.sql ??
  postgres(process.env.DATABASE_URL as string, {
    max: 10,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

/**
 * The SQLSTATE code and message of a Postgres error, or null. Checked by shape, not instanceof:
 * Next can load the postgres package more than once, so its PostgresError class isn't always the same.
 */
export function pgError(err: unknown): { code: string; message: string } | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { name?: unknown; code?: unknown; message?: unknown };
  return e.name === "PostgresError" && typeof e.code === "string" && typeof e.message === "string"
    ? { code: e.code, message: e.message }
    : null;
}
