import { randomUUID } from "node:crypto";
import type { Profile } from "next-auth";
import { describe, expect, it } from "vitest";
import { signInGate } from "@/lib/auth";
import { sql } from "@/lib/db";
import { createUser } from "../fixtures";

const profile = (p: Partial<Profile>): Profile => ({
  sub: randomUUID(),
  email_verified: true,
  ...p,
});

async function subOf(id: string) {
  const [row] = await sql<{ google_sub: string | null }[]>`
    SELECT google_sub FROM users WHERE id = ${id}`;
  return row.google_sub;
}

describe("signInGate", () => {
  it("refuses an unverified email", async () => {
    const user = await createUser();
    expect(await signInGate(profile({ email: user.email, email_verified: false }))).toBe(false);
    expect(await subOf(user.id)).toBeNull();
  });

  it("refuses an email with no users row", async () => {
    expect(await signInGate(profile({ email: `nobody-${randomUUID()}@example.com` }))).toBe(false);
  });

  it("refuses an inactive user", async () => {
    const user = await createUser({ isActive: false });
    expect(await signInGate(profile({ email: user.email }))).toBe(false);
  });

  it("binds the Google sub on the first sign-in, case-insensitively", async () => {
    const user = await createUser();
    const sub = randomUUID();
    expect(await signInGate(profile({ email: user.email.toUpperCase(), sub }))).toBe(true);
    expect(await subOf(user.id)).toBe(sub);
    // the same account signs in again
    expect(await signInGate(profile({ email: user.email, sub }))).toBe(true);
  });

  it("refuses a different sub for an already bound email", async () => {
    const sub = randomUUID();
    const user = await createUser({ googleSub: sub });
    expect(await signInGate(profile({ email: user.email, sub: randomUUID() }))).toBe(false);
    expect(await subOf(user.id)).toBe(sub);
  });

  it("refuses a Google account already bound to another user", async () => {
    const sub = randomUUID();
    await createUser({ googleSub: sub });
    const other = await createUser();
    expect(await signInGate(profile({ email: other.email, sub }))).toBe(false);
    expect(await subOf(other.id)).toBeNull();
  });
});
