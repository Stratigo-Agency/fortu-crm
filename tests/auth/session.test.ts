import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ROLE_RECHECK_MS, refreshToken } from "@/lib/auth";
import { sql } from "@/lib/db";
import { isPublicPath, safeNext } from "@/lib/publicPaths";
import { createUser } from "../fixtures";

describe("refreshToken", () => {
  it("puts id, role and full_name on the token at sign-in", async () => {
    const sub = randomUUID();
    const user = await createUser({ role: "sales_lead", googleSub: sub });
    const token = await refreshToken({}, { sub }, 1_000);
    expect(token).toMatchObject({
      id: user.id,
      email: user.email,
      role: "sales_lead",
      full_name: "Uji sales_lead",
      roleCheckedAt: 1_000,
    });
  });

  it("keeps the token without a read inside 5 minutes, re-reads the role after", async () => {
    const sub = randomUUID();
    const user = await createUser({ role: "sales_rep", googleSub: sub });
    const token = (await refreshToken({}, { sub }, 0))!;
    await sql`UPDATE users SET role = 'sales_lead' WHERE id = ${user.id}`;

    expect((await refreshToken(token, undefined, ROLE_RECHECK_MS - 1))?.role).toBe("sales_rep");
    expect((await refreshToken(token, undefined, ROLE_RECHECK_MS))?.role).toBe("sales_lead");
  });

  it("signs out a user who was deactivated", async () => {
    const sub = randomUUID();
    const user = await createUser({ googleSub: sub });
    const token = (await refreshToken({}, { sub }, 0))!;
    await sql`UPDATE users SET is_active = false WHERE id = ${user.id}`;
    expect(await refreshToken(token, undefined, ROLE_RECHECK_MS)).toBeNull();
  });

  it("refuses a token without a user id", async () => {
    expect(await refreshToken({}, undefined)).toBeNull();
  });
});

describe("isPublicPath", () => {
  it.each(["/masuk", "/masuk/", "/api/auth/callback/google", "/api/v1/ingest/web-form", "/go/wa"])(
    "%s is public",
    (p) => expect(isPublicPath(p)).toBe(true),
  );
  it.each(["/", "/pipeline", "/masukan", "/api/other", "/gopher", "/deal/1"])(
    "%s needs sign-in",
    (p) => expect(isPublicPath(p)).toBe(false),
  );
});

describe("safeNext", () => {
  it.each([
    [undefined, "/"],
    ["/pipeline?view=list", "/pipeline?view=list"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
  ])("%s → %s", (input, out) => expect(safeNext(input)).toBe(out));
});
