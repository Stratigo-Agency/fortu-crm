import { InvalidPhoneError } from "./errors";

const E164_ID = /^\+62\d{8,13}$/;

/**
 * Any way a rep or a form writes an Indonesian number → E.164.
 * "0812-3456-7890", "62812 3456 7890", "+62 812-3456-7890", "8123456789" → "+6281234567890".
 */
export function normalizePhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  const e164 = `+${digits}`;
  if (!E164_ID.test(e164)) throw new InvalidPhoneError(input);
  return e164;
}

/** "+6281234567890" → "+62 812-3456-7890" (display only). */
export function formatPhone(e164: string): string {
  const m = /^\+62(\d{3})(\d+)$/.exec(e164);
  if (!m) return e164;
  const groups = m[2].match(/\d{1,4}/g) ?? [];
  return `+62 ${m[1]}-${groups.join("-")}`;
}
