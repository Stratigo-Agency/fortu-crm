// Sets a password for registered users. Writes only the hash to the database.
//   node scripts/set-password.mjs a@fortu.co.id b@fortu.co.id   random passwords, saved to credentials.local.txt
//   node scripts/set-password.mjs a@fortu.co.id --password '...'  one chosen password
// credentials.local.txt is gitignored; give each person their line, then delete the file.
import { writeFile } from "node:fs/promises";
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
  const sql = connect(databaseUrl());
  const lines = [];
  try {
    for (const email of emails) {
      const password = chosen ?? generatePassword();
      const rows = await sql`
        UPDATE users SET password_hash = ${await hashPassword(password)}
         WHERE lower(email) = lower(${email}) RETURNING email, role`;
      if (rows.length !== 1) {
        console.error(`error: no user with email ${email}`);
        process.exit(1);
      }
      lines.push(`${rows[0].email}\t${rows[0].role}\t${password}`);
      console.log(`password set for ${rows[0].email}`);
    }
  } finally {
    await sql.end();
  }
  if (!chosen) {
    const file = path.join(root, "credentials.local.txt");
    await writeFile(file, `email\trole\tpassword\n${lines.join("\n")}\n`, { mode: 0o600 });
    console.log(`passwords written to ${path.relative(root, file)} (gitignored)`);
  }
}
