import { describe, expect, it } from "vitest";
import { authorizeCredentials, refreshToken } from "@/lib/auth";
import { sql } from "@/lib/db";
import { generatePassword, hashPassword, verifyPassword } from "@/lib/password.mjs";
import { createUser } from "../fixtures";

describe("password hashing", () => {
  it("verifies the right password and refuses a wrong one", async () => {
    const hash = await hashPassword("rahasia-123");
    expect(hash).toMatch(/^scrypt\$16384\$/);
    expect(hash).not.toContain("rahasia");
    expect(await verifyPassword("rahasia-123", hash)).toBe(true);
    expect(await verifyPassword("rahasia-124", hash)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("sama")).not.toBe(await hashPassword("sama"));
  });

  it("refuses an empty or malformed stored value", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "plain-text")).toBe(false);
  });

  it("generates a different readable password each time", () => {
    expect(generatePassword()).toMatch(/^[a-z]+-[a-z]+-\d{4}-[a-z]+$/);
    expect(generatePassword()).not.toBe(generatePassword());
  });
});

describe("authorizeCredentials", () => {
  const password = "kuda-biru-1234-tegas";

  it("signs in a registered user, case-insensitively, and records the login", async () => {
    const user = await createUser({ passwordHash: await hashPassword(password) });
    expect(await authorizeCredentials(user.email.toUpperCase(), password)).toEqual({ id: user.id });
    const [row] = await sql`SELECT last_login_at FROM users WHERE id = ${user.id}`;
    expect(row.last_login_at).not.toBeNull();
  });

  it("refuses a wrong password", async () => {
    const user = await createUser({ passwordHash: await hashPassword(password) });
    expect(await authorizeCredentials(user.email, "salah")).toBeNull();
  });

  it("refuses an unknown email, an inactive user and a user with no password", async () => {
    expect(await authorizeCredentials("tidak-ada@example.com", password)).toBeNull();
    const inactive = await createUser({ isActive: false, passwordHash: await hashPassword(password) });
    expect(await authorizeCredentials(inactive.email, password)).toBeNull();
    const googleOnly = await createUser();
    expect(await authorizeCredentials(googleOnly.email, password)).toBeNull();
  });

  it("refuses missing or non-string input", async () => {
    expect(await authorizeCredentials(undefined, undefined)).toBeNull();
    expect(await authorizeCredentials("", "")).toBeNull();
    expect(await authorizeCredentials(["a"], password)).toBeNull();
  });

  it("puts the user's role on the token after a password sign-in", async () => {
    const user = await createUser({ role: "sales_lead", passwordHash: await hashPassword(password) });
    const token = await refreshToken({}, undefined, 5_000, user.id);
    expect(token).toMatchObject({ id: user.id, role: "sales_lead", roleCheckedAt: 5_000 });
  });
});
