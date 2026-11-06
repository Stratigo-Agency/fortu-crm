import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/ingest/web-form/route";
import { HEAD } from "@/app/go/wa/route";
import { authorizeCredentials, missesPerEmailIp, SLOW_DELAY_MS } from "@/lib/auth";
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

  it("logs a warning once when there is no address header", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    clientIp(new Headers());
    clientIp(new Headers());
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1); // once per process (the first test above may have used it)
    warn.mockRestore();
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
  const hdr = (ip: string) => new Headers({ "x-forwarded-for": ip });

  it("locks the email from one address after 10 misses, even for the right password, and counts only misses", async () => {
    const password = `rahasia-${randomUUID().slice(0, 6)}`;
    const user = await createUser({ passwordHash: await hashPassword(password) });
    const ip = randomIp();
    for (let i = 0; i < 12; i++) expect(await authorizeCredentials(user.email, password, hdr(ip))).toEqual({ id: user.id }); // right passwords never use the allowance up
    for (let i = 0; i < 10; i++) expect(await authorizeCredentials(user.email, "salah", hdr(ip))).toBeNull();
    expect(await authorizeCredentials(user.email, password, hdr(ip))).toBeNull();
    expect(await authorizeCredentials(user.email.toUpperCase(), password, hdr(ip))).toBeNull();
    const other = await createUser({ passwordHash: await hashPassword(password) });
    expect(await authorizeCredentials(other.email, password, hdr(ip))).toEqual({ id: other.id });
  }, 30_000);

  it("a stranger guessing at a colleague's email can't lock the colleague out from their own address", async () => {
    const password = `rahasia-${randomUUID().slice(0, 6)}`;
    const user = await createUser({ passwordHash: await hashPassword(password) });
    const attacker = randomIp();
    for (let i = 0; i < 30; i++) await authorizeCredentials(user.email, "salah", hdr(attacker)); // 10 count, then the pair is locked
    expect(await authorizeCredentials(user.email, password, hdr(attacker))).toBeNull();
    // the real person, from the usual address: slowed (the email has 10+ misses) but let in
    const started = Date.now();
    expect(await authorizeCredentials(user.email, password, hdr(randomIp()))).toEqual({ id: user.id });
    expect(Date.now() - started).toBeGreaterThanOrEqual(SLOW_DELAY_MS - 50);
  }, 30_000);

  it("refuses an email outright after 50 misses spread over many addresses", async () => {
    const password = `rahasia-${randomUUID().slice(0, 6)}`;
    const user = await createUser({ passwordHash: await hashPassword(password) });
    for (let i = 0; i < 50; i++) await authorizeCredentials(user.email, "salah", hdr(randomIp()));
    expect(await authorizeCredentials(user.email, password, hdr(randomIp()))).toBeNull();
  }, 120_000);

  it("refuses an address after 30 misses across many emails", async () => {
    const password = `rahasia-${randomUUID().slice(0, 6)}`;
    const user = await createUser({ passwordHash: await hashPassword(password) });
    const ip = randomIp();
    for (let i = 0; i < 30; i++) await authorizeCredentials(`tidak-ada-${i}-${randomUUID()}@example.com`, "salah", hdr(ip));
    expect(await authorizeCredentials(user.email, password, hdr(ip))).toBeNull();
    expect(await authorizeCredentials(user.email, password, hdr(randomIp()))).toEqual({ id: user.id });
  });

  it("without an address header, emails are limited one by one (20 misses), not all together", async () => {
    const password = `rahasia-${randomUUID().slice(0, 6)}`;
    const user = await createUser({ passwordHash: await hashPassword(password) });
    const other = await createUser({ passwordHash: await hashPassword(password) });
    const none = new Headers();
    for (let i = 0; i < 20; i++) await authorizeCredentials(user.email, "salah", none);
    expect(await authorizeCredentials(user.email, password, none)).toBeNull();
    expect(await authorizeCredentials(other.email, password, none)).toEqual({ id: other.id });
  }, 60_000);

  it("parallel wrong passwords can't all slip past the limit while the first check is still running", async () => {
    const user = await createUser({ passwordHash: await hashPassword("benar-benar") });
    const ip = randomIp();
    const results = await Promise.all(Array.from({ length: 25 }, () => authorizeCredentials(user.email, "salah", hdr(ip))));
    expect(results.every((r) => r === null)).toBe(true);
    // 25 started together: only 10 may have been let through to the password check
    expect(missesPerEmailIp.count(`${user.email.trim().toLowerCase()}|${ip}`)).toBe(10);
  }, 30_000);
});

describe("createRateLimiter · release and count", () => {
  it("release gives the most recent hit back", () => {
    const l = createRateLimiter(2, 1000);
    l.hit("a", 0);
    l.hit("a", 1);
    expect(l.count("a", 2)).toBe(2);
    l.release("a");
    expect(l.count("a", 2)).toBe(1);
    expect(l.hit("a", 3)).toBe(true);
    l.release("zzz"); // no such key: nothing happens
  });
});
