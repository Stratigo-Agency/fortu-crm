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
