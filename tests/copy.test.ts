import { describe, expect, it } from "vitest";
import { t } from "@/lib/copy";

describe("t", () => {
  it("reads a dotted key", () => {
    expect(t("authz.forbidden")).toBe("Kamu hanya bisa mengubah data milikmu sendiri.");
  });

  it("fills {placeholders}", () => {
    expect(t("home.dbConnected", { n: 32 })).toBe("Database terhubung · 32 produk");
  });

  it("leaves unknown placeholders as they are", () => {
    expect(t("home.dbConnected")).toBe("Database terhubung · {n} produk");
    expect(t("home.dbConnected", { m: 1 })).toBe("Database terhubung · {n} produk");
  });

  it("returns the key when it is missing or not a string", () => {
    expect(t("home.nope")).toBe("home.nope");
    expect(t("home")).toBe("home");
    expect(t("authz.forbidden.deeper")).toBe("authz.forbidden.deeper");
  });
});
