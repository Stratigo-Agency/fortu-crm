import { describe, expect, it } from "vitest";
import { InvalidPhoneError } from "@/lib/ingest/errors";
import { formatPhone, normalizePhone } from "@/lib/ingest/phone";

describe("normalizePhone", () => {
  it.each([
    "0812-3456-7890",
    "62812 3456 7890",
    "+62 812-3456-7890",
    "812 3456 7890",
    "(0812) 3456.7890",
    "+62 (0)812-3456-7890",
    "62 0812 3456 7890",
  ])(
    "%s → +6281234567890",
    (input) => expect(normalizePhone(input)).toBe("+6281234567890"),
  );

  it("handles short and long Indonesian numbers", () => {
    expect(normalizePhone("8123456789")).toBe("+628123456789");
    expect(normalizePhone("021-555-1234")).toBe("+62215551234");
  });

  it.each(["12345", "", "abc", "+65 9123 4567", "0812", "+62 812 3456 7890 1234 5"])("%s throws", (input) => {
    expect(() => normalizePhone(input)).toThrow(InvalidPhoneError);
    try {
      normalizePhone(input);
    } catch (err) {
      expect((err as InvalidPhoneError).code).toBe("invalid_phone");
    }
  });
});

describe("formatPhone", () => {
  it.each([
    ["+6281234567890", "+62 812-3456-7890"],
    ["+628123456789", "+62 812-3456-789"],
    ["+62812345678901", "+62 812-3456-7890-1"],
    ["+6591234567", "+6591234567"],
  ])("%s → %s", (input, out) => expect(formatPhone(input)).toBe(out));
});
