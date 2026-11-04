// Password hashing with Node's scrypt: no extra dependency, same code for the app and scripts/set-password.mjs.
// Stored form: "scrypt$<N>$<salt base64>$<hash base64>".
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const N = 16384;
const KEY_LEN = 64;

/** @param {string} password @returns {Promise<string>} */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN, { N });
  return `scrypt$${N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** @param {string} password @param {string | null | undefined} stored @returns {Promise<boolean>} */
export async function verifyPassword(password, stored) {
  const [scheme, n, salt, hash] = (stored ?? "").split("$");
  if (scheme !== "scrypt" || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n) });
  return timingSafeEqual(actual, expected);
}

/** A readable random password, e.g. "kuda-biru-7431-tegas". */
export function generatePassword() {
  const words = ["kuda", "biru", "tegas", "pagi", "laut", "bukit", "jalan", "cahaya", "angin", "batu", "sungai", "layar"];
  const pick = () => words[randomBytes(1)[0] % words.length];
  const digits = String(randomBytes(2).readUInt16BE() % 10000).padStart(4, "0");
  return `${pick()}-${pick()}-${digits}-${pick()}`;
}
