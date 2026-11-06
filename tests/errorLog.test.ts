import { describe, expect, it } from "vitest";
import { requestErrorLine } from "@/lib/errorLog";

describe("requestErrorLine", () => {
  it("keeps the error name, digest, method and path, and nothing a person typed", () => {
    class PgError extends Error {}
    const err = Object.assign(new PgError("duplicate key value (phone_e164)=(+6281234567890)"), { name: "PostgresError", digest: "123456" });
    const line = requestErrorLine(err, { path: "/kontak?q=Budi%20Santoso&phone=0812", method: "POST" }, { routePath: "/kontak", routeType: "action" }, new Date("2026-11-06T02:00:00Z"));
    expect(line).toEqual({
      event: "request_error", name: "PostgresError", digest: "123456", method: "POST", path: "/kontak",
      routePath: "/kontak", routeType: "action", at: "2026-11-06T02:00:00.000Z",
    });
    const text = JSON.stringify(line);
    expect(text).not.toContain("6281234567890");
    expect(text).not.toContain("Budi");
  });

  it("copes with something that is not an Error", () => {
    expect(requestErrorLine("boom", { path: "/x", method: "GET" })).toMatchObject({ name: "Error", digest: null, routePath: null });
    expect(requestErrorLine(null, { path: "/x", method: "GET" }).name).toBe("Error");
  });
});
