import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { appVersion } from "@/lib/version";

describe("GET /api/health", () => {
  it("answers 200 with the database and version, and nothing secret", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ status: "ok", db: "ok", version: expect.any(String) });
    expect(JSON.stringify(body)).not.toMatch(/postgres|password|secret/i);
  });
});

describe("appVersion", () => {
  it("is the short commit on Railway and the package version elsewhere", () => {
    expect(appVersion({ RAILWAY_GIT_COMMIT_SHA: "0123456789abcdef" })).toBe("0123456");
    expect(appVersion({})).toMatch(/^\d+\.\d+\.\d+/);
  });
});
