import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/ingest/web-form/route";
import { HEAD } from "@/app/go/wa/route";
import { authorizeCredentials } from "@/lib/auth";
import { hashPassword } from "@/lib/password.mjs";
import { clientIp, createRateLimiter } from "@/lib/webform/rateLimit";
import { createUser } from "./fixtures";

const randomIp = () => `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

describe("createRateLimiter", () => {
  it("allows() counts nothing, hit() counts, and the window slides", () => {
    const l = createRateLimiter(2, 1000);
    expect(l.allows("a", 0)).toBe(true);
    expect(l.allows("a", 0)).toBe(true);
    expect(l.hit("a", 0)).toBe(true);
    expect(l.hit("a", 10)).toBe(true);
    expect(l.allows("a", 20)).toBe(false);
    expect(l.hit("a", 20)).toBe(false);
    expect(l.allows("b", 20)).toBe(true);
    expect(l.hit("a", 1001)).toBe(true); // the first hit has left the window
  });

  it("clientIp trusts the last x-forwarded-for entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("/go/wa HEAD", () => {
  it("is limited like GET: 429 after 20 in a minute from one IP", async () => {
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await HEAD(new Request("http://localhost/go/wa?line=tidak-ada", { method: "HEAD", headers: { "x-forwarded-for": ip } }))).status);
    expect(statuses.slice(0, 20).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });
});

describe("POST /api/v1/ingest/web-form", () => {
  it("answers 429 after 60 requests a minute from one IP, before looking at the signature, and not for another IP", async () => {
    process.env.WEBFORM_HMAC_SECRET = "uji-rahasia-webform";
    const ip = randomIp();
    const post = (from: string) => POST(new Request("http://localhost/api/v1/ingest/web-form", { method: "POST", body: "{}", headers: { "x-forwarded-for": from } }));
    const statuses: number[] = [];
    for (let i = 0; i < 62; i++) statuses.push((await post(ip)).status);
    expect(statuses.slice(0, 60).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(60)).toEqual([429, 429]);
    const limited = await post(ip);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(await limited.json()).toMatchObject({ error: "rate_limited" });
    expect((await post(randomIp())).status).toBe(401);
  });
});

describe("password sign-in · too many wrong passwords", () => {
  it("refuses even the right password after 10 misses on one email, and counts only misses", async () => {
    const password = `rahasia-${randomUUID().slice(0, 6)}`;
    const user = await createUser({ passwordHash: await hashPassword(password) });
    // right passwords never use the allowance up
    for (let i = 0; i < 12; i++) expect(await authorizeCredentials(user.email, password, new Headers({ "x-forwarded-for": randomIp() }))).toEqual({ id: user.id });
    for (let i = 0; i < 10; i++) expect(await authorizeCredentials(user.email, "salah", new Headers({ "x-forwarded-for": randomIp() }))).toBeNull();
    expect(await authorizeCredentials(user.email, password, new Headers({ "x-forwarded-for": randomIp() }))).toBeNull();
    expect(await authorizeCredentials(user.email.toUpperCase(), password, new Headers({ "x-forwarded-for": randomIp() }))).toBeNull();
    // someone else is not affected
    const other = await createUser({ passwordHash: await hashPassword(password) });
    expect(await authorizeCredentials(other.email, password, new Headers({ "x-forwarded-for": randomIp() }))).toEqual({ id: other.id });
  });

  it("refuses an address after 30 misses across many emails", async () => {
    const password = `rahasia-${randomUUID().slice(0, 6)}`;
    const user = await createUser({ passwordHash: await hashPassword(password) });
    const ip = randomIp();
    const h = () => new Headers({ "x-forwarded-for": ip });
    for (let i = 0; i < 30; i++) await authorizeCredentials(`tidak-ada-${i}-${randomUUID()}@example.com`, "salah", h());
    expect(await authorizeCredentials(user.email, password, h())).toBeNull();
    expect(await authorizeCredentials(user.email, password, new Headers({ "x-forwarded-for": randomIp() }))).toEqual({ id: user.id });
  });
});
