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

/**
 * False for anything that isn't a hash made by hashPassword(): wrong scheme, other cost
 * parameters, wrong length, bad base64. Never throws, never accepts an empty hash.
 * @param {string} password @param {string | null | undefined} stored @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  try {
    const [scheme, n, salt, hash] = (stored ?? "").split("$");
    if (scheme !== "scrypt" || Number(n) !== N || !salt || !hash) return false;
    const saltBytes = Buffer.from(salt, "base64");
    const expected = Buffer.from(hash, "base64");
    if (saltBytes.length !== 16 || expected.length !== KEY_LEN) return false;
    const actual = await scryptAsync(password, saltBytes, KEY_LEN, { N });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** A readable random password, e.g. "kuda-biru-7431-tegas". */
export function generatePassword() {
  const words = ["kuda", "biru", "tegas", "pagi", "laut", "bukit", "jalan", "cahaya", "angin", "batu", "sungai", "layar"];
  const pick = () => words[randomBytes(1)[0] % words.length];
  const digits = String(randomBytes(2).readUInt16BE() % 10000).padStart(4, "0");
  return `${pick()}-${pick()}-${digits}-${pick()}`;
}
