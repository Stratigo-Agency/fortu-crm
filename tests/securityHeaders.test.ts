import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/auth/[...nextauth]/route";
import { contentSecurityPolicy, META_SDK_PAGE, metaSdkPageHeaders, securityHeaders } from "@/lib/securityHeaders";

const value = (headers: { key: string; value: string }[], key: string) => headers.find((h) => h.key === key)?.value;

describe("security headers", () => {
  const prod = securityHeaders({ dev: false, production: true });

  it("forbids framing, sniffing and plugins, and trims the referrer", () => {
    expect(value(prod, "X-Frame-Options")).toBe("DENY");
    expect(value(prod, "X-Content-Type-Options")).toBe("nosniff");
    expect(value(prod, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(value(prod, "Permissions-Policy")).toContain("camera=()");
    const csp = value(prod, "Content-Security-Policy") as string;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("default-src 'self'");
  });

  it("lets only our own origin load scripts, and never allows eval in production", () => {
    const script = (contentSecurityPolicy(false).split("; ").find((d) => d.startsWith("script-src ")) as string).split(" ");
    expect(script).toEqual(["script-src", "'self'", "'unsafe-inline'"]);
    expect(contentSecurityPolicy(true)).toContain("'unsafe-eval'");
  });

  it("lets the sign-in form go to Google and nowhere else", () => {
    expect(contentSecurityPolicy(false)).toContain("form-action 'self' https://accounts.google.com;");
  });

  it("allows Meta's SDK on Pengaturan › WhatsApp only, and still forbids framing the app there", () => {
    expect(contentSecurityPolicy(false)).not.toContain("facebook");
    const meta = metaSdkPageHeaders({ dev: false })[0].value;
    expect(META_SDK_PAGE).toBe("/pengaturan/whatsapp");
    expect(meta).toContain("script-src 'self' 'unsafe-inline' https://connect.facebook.net;");
    expect(meta).toContain("frame-src https://www.facebook.com");
    expect(meta).toContain("frame-ancestors 'none'");
    expect(meta).not.toContain("'unsafe-eval'");
  });

  it("sends HSTS in production only", () => {
    expect(value(prod, "Strict-Transport-Security")).toBe("max-age=31536000");
    expect(value(securityHeaders({ dev: true, production: false }), "Strict-Transport-Security")).toBeUndefined();
  });
});

describe("Auth.js cookies behind https", () => {
  it("the CSRF cookie is __Host-, Secure, HttpOnly and SameSite=Lax", async () => {
    process.env.AUTH_URL = "https://crm.example.com";
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || "uji-rahasia";
    const res = await GET(new NextRequest("https://crm.example.com/api/auth/csrf"));
    const cookie = res.headers.getSetCookie().join("\n");
    expect(cookie).toMatch(/__Host-authjs\.csrf-token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});
