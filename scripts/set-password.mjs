// Sets a password for registered users. Writes only the hash to the database.
//   node scripts/set-password.mjs nama@fortu.co.id nama2@fortu.co.id   random passwords, saved to credentials.local.txt
//   node scripts/set-password.mjs nama@fortu.co.id --password '...'  one chosen password
// credentials.local.txt is gitignored; give each person their line, then delete the file.
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { generatePassword, hashPassword } from "../lib/password.mjs";
import { connect, databaseUrl, isMain, root } from "./lib.mjs";

if (isMain(import.meta)) {
  const args = process.argv.slice(2);
  const pi = args.indexOf("--password");
  const chosen = pi >= 0 ? args[pi + 1] : undefined;
  const emails = args.filter((a, i) => !a.startsWith("--") && (pi < 0 || i !== pi + 1));
  if (!emails.length || (pi >= 0 && !chosen)) {
    console.error("usage: node scripts/set-password.mjs <email>... [--password <password>]");
    process.exit(1);
  }
  if (chosen !== undefined && chosen.length < 10) {
    console.error("error: --password needs at least 10 characters");
    process.exit(1);
  }
  const sql = connect(databaseUrl());
  const lines = [];
  try {
    // Check every email first, so a typo can't leave some users with passwords nobody knows.
    const found = await sql`SELECT lower(email) AS email FROM users WHERE lower(email) IN ${sql(emails.map((e) => e.toLowerCase()))}`;
    const missing = emails.filter((e) => !found.some((r) => r.email === e.toLowerCase()));
    if (missing.length) {
      console.error(`error: no user with email ${missing.join(", ")}; nothing was changed`);
      process.exit(1);
    }
    for (const email of emails) {
      const password = chosen ?? generatePassword();
      const [row] = await sql`
        UPDATE users SET password_hash = ${await hashPassword(password)}
         WHERE lower(email) = lower(${email}) RETURNING email, role`;
      lines.push(`${row.email}\t${row.role}\t${password}`);
      console.log(`password set for ${row.email}`);
    }
  } finally {
    await sql.end();
  }
  if (!chosen) {
    const file = path.join(root, "credentials.local.txt");
    await writeFile(file, `email\trole\tpassword\n${lines.join("\n")}\n`, { mode: 0o600 });
    await chmod(file, 0o600); // mode only applies to a new file
    console.log(`passwords written to ${path.relative(root, file)} (gitignored)`);
  }
}
