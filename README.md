# Fortu CRM

Internal sales CRM for Fortu Digital Indonesia. Next.js (App Router) + PostgreSQL, deployed on Railway.
Project rules: [CLAUDE.md](CLAUDE.md). Build plan: [BUILD_PLAN.md](BUILD_PLAN.md).

## Run locally

Needs Node 24+ and Docker. Port 5432 must be free (stop any local Postgres first).

```bash
npm install
cp .env.example .env.local
npm run db:up
npm run db:migrate && npm run db:seed
npm run dev
```

Open http://localhost:3000. It shows "Database terhubung · 32 produk" when everything is connected.

## Other commands

| Command | What it does |
| --- | --- |
| `npm run db:up` | Starts the `fortu-pg` container (Postgres 16, password `dev`). Does nothing if it already runs. |
| `npm run db:migrate` | Applies new files in `db/migrations/` in order and records them in `schema_migrations`. |
| `npm run db:seed` | Runs `db/seeds/*.sql` (safe to repeat). `*.local.sql` seeds stay out of git. |
| `npm run db:test:reset` | Recreates the `fortu_test` database and migrates it. `npm test` does this once per run. |
| `npm test` | Vitest (uses `DATABASE_URL_TEST`). |
| `npm run lint` | ESLint. |
| `npm run build` / `npm start` | Production build and the standalone server Railway runs. |
