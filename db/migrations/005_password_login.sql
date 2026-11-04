-- 005 · Email + password sign-in (4 Nov 2026)
-- Until the team's @fortu.co.id addresses have Google accounts, people sign in with email + password.
-- password_hash = "scrypt$<N>$<salt b64>$<hash b64>" written by scripts/set-password.mjs (never plain text).
-- NULL = this user cannot sign in with a password (Google only).
ALTER TABLE users ADD COLUMN password_hash text;
