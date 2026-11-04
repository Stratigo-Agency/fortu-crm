import { afterEach, describe, expect, it, vi } from "vitest";
import { type MessageKey, t } from "@/lib/copy";

afterEach(() => vi.unstubAllEnvs());

describe("t", () => {
  it("reads a dotted key", () => {
    expect(t("authz.forbidden")).toBe("Kamu hanya bisa mengubah data milikmu sendiri.");
  });

  it("fills {placeholders} and leaves unknown ones", () => {
    expect(t("common.daysAgo", { n: 3 })).toBe("3 hari lalu");
    expect(t("common.daysAgo")).toBe("{n} hari lalu");
    expect(t("common.daysAgo", { m: 1 })).toBe("{n} hari lalu");
  });

  it("throws on a missing key outside production", () => {
    expect(() => t("nav.nope" as MessageKey)).toThrow("Missing copy key: nav.nope");
    expect(() => t("nav" as MessageKey)).toThrow();
  });

  it("returns the key in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(t("nav.nope" as MessageKey)).toBe("nav.nope");
  });
});
