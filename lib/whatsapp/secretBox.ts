import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Encrypts the WhatsApp business token before it is stored (wa_lines.meta_business_token_enc).
// AES-256-GCM with a key derived from WA_TOKEN_KEY, or AUTH_SECRET when that is not set. Changing the secret makes
// stored tokens unreadable: the line then has to be connected again (docs/whatsapp-coexistence.md).

function key(): Buffer {
  const secret = process.env.WA_TOKEN_KEY || process.env.AUTH_SECRET;
  if (!secret) throw new Error("WA_TOKEN_KEY or AUTH_SECRET must be set to store a WhatsApp token");
  return Buffer.from(hkdfSync("sha256", secret, "fortu-crm", "wa-business-token", 32));
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function open(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unknown sealed token format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
