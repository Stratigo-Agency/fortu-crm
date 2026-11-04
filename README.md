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

Open http://localhost:3000. You land on the sign-in page (`/masuk`) until Google sign-in is set up (below).

## Email and password sign-in

Until the team's work addresses have Google accounts, people sign in with email and password.
Only users registered in `users` can sign in, and only a hash is stored in the database.

```bash
npm run db:seed                                          # registers users from db/seeds/*.sql
npm run db:set-password -- nama@fortu.co.id nama2@fortu.co.id
```

The script sets a random password per user and writes them to `credentials.local.txt` (gitignored).
Give each person their line, then delete the file. To choose one password: `--password '<password>'`.
Real team users live in `db/seeds/90_users.local.sql` (gitignored), shaped like `90_users.example.sql`.

## Google sign-in

Optional. The "Masuk dengan Google" button shows only when `AUTH_GOOGLE_ID` is set.

Only people with an active row in `users` can sign in. Nobody self-registers.

1. **AUTH_SECRET**: run `openssl rand -base64 33` and paste the value after `AUTH_SECRET=` in `.env.local`.
   (Older Auth.js docs say `npx auth secret`; the `auth` package on npm is now another library's CLI and doesn't set it.)
2. **Google OAuth client**: in Google Cloud Console → APIs & Services → Credentials, create an
   "OAuth client ID" of type "Web application" with the redirect URI
   `http://localhost:3000/api/auth/callback/google`. Put its ID and secret in `AUTH_GOOGLE_ID` and
   `AUTH_GOOGLE_SECRET` in `.env.local`. (At deploy, add the Railway URL's `/api/auth/callback/google` too.)
3. **Your user row**: copy `db/seeds/90_users.example.sql` to `db/seeds/90_users.local.sql` (gitignored),
   replace the example rows with real names, emails and roles, and run `npm run db:seed`.
4. Restart `npm run dev`, open http://localhost:3000 and choose "Masuk dengan Google".
   A registered account lands on `/` ("Database terhubung · 32 produk"); any other account sees
   "Akun Google ini belum terdaftar".

## Other commands

| Command | What it does |
| --- | --- |
| `npm run db:up` | Starts the `fortu-pg` container (Postgres 16, password `dev`). Does nothing if it already runs. |
| `npm run db:migrate` | Applies new files in `db/migrations/` in order and records them in `schema_migrations`. |
| `npm run db:set-password -- <email>...` | Sets random passwords (hash in the database, text in `credentials.local.txt`). |
| `npm run db:seed` | Runs `db/seeds/*.sql` (safe to repeat): example users, products, and your `*.local.sql` seeds, which stay out of git. |
| `npm run db:test:reset` | Recreates the `fortu_test` database and migrates it. `npm test` does this once per run. |
| `npm test` | Vitest (uses `DATABASE_URL_TEST`). |
| `npm run lint` | ESLint. |
| `npm run build` / `npm start` | Production build and the standalone server Railway runs. |
