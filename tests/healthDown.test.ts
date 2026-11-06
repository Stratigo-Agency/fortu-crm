import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ sql: () => Promise.reject(new Error('connect ECONNREFUSED postgres://user:secret@db:5432')) }));

describe("GET /api/health with the database down", () => {
  it("answers 503 and does not leak the connection error", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toBe(JSON.stringify({ status: "error", db: "down", version: JSON.parse(text).version }));
    expect(text).not.toMatch(/secret|ECONNREFUSED/);
  });
});
