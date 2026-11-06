import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importMsrp, parseMsrpCsv } from "../scripts/import-msrp.mjs";
import { sql } from "@/lib/db";
import { createProduct } from "./fixtures";

const url = process.env.DATABASE_URL_TEST as string;
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fortu-msrp-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const csv = async (name: string, text: string) => {
  const file = path.join(dir, name);
  await writeFile(file, text);
  return file;
};
const product = async (sku: string) => {
  const [p] = await sql<{ list_price: string; max_discount_pct: string | null }[]>`
    SELECT list_price::text, max_discount_pct::text FROM products WHERE sku = ${sku}`;
  return p;
};

describe("parseMsrpCsv", () => {
  it("reads whole Rupiah in plain or dotted form, comma percents and an empty limit", () => {
    const { rows, errors } = parseMsrpCsv("﻿sku;msrp;max_discount_pct\r\nA1;85000000;15\r\nA2;Rp62.500.000;12,5\r\nA3;1000;\r\n");
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { sku: "A1", msrp: 85_000_000, maxDiscountPct: 15 },
      { sku: "A2", msrp: 62_500_000, maxDiscountPct: 12.5 },
      { sku: "A3", msrp: 1000, maxDiscountPct: null },
    ]);
  });

  it("lists every bad line: a Rp0 price, a limit over 100, a repeated SKU, a missing column", () => {
    const { errors } = parseMsrpCsv("sku;msrp;max_discount_pct\nA1;0;15\nA2;1000;150\nA2;1000;5\nA4;1000\n");
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/line 2.*msrp/);
    expect(errors[1]).toMatch(/line 3.*max_discount_pct/);
    expect(errors[2]).toMatch(/line 4.*twice/);
    expect(errors[3]).toMatch(/line 5.*3 columns/);
  });

  it("rejects a wrong header", () => {
    expect(parseMsrpCsv("kode;harga\nA;1\n").errors[0]).toMatch(/header/);
  });
});

describe("importMsrp", () => {
  it("sets the MSRP and the limit, skips unknown SKUs and reports them", async () => {
    const a = await createProduct({ listPrice: 1 });
    const b = await createProduct({ listPrice: 1 });
    const file = await csv("ok.csv", `sku;msrp;max_discount_pct\n${a.sku};85000000;10\n${b.sku};62500000;\nNOPE-1;1000;5\n`);
    const logs: string[] = [];
    const r = await importMsrp({ url, file, log: (l: string) => logs.push(l) });
    expect(r).toEqual({ updated: 2, unchanged: 0, unknown: ["NOPE-1"] });
    expect(await product(a.sku)).toEqual({ list_price: "85000000", max_discount_pct: "10.00" });
    expect(await product(b.sku)).toEqual({ list_price: "62500000", max_discount_pct: null });
    expect(logs.join("\n")).toContain("NOPE-1");

    // a second run changes nothing
    expect((await importMsrp({ url, file, log: () => {} })).updated).toBe(0);
  });

  it("--dry-run reports the changes and writes nothing", async () => {
    const a = await createProduct({ listPrice: 7_000_000 });
    const file = await csv("dry.csv", `sku;msrp;max_discount_pct\n${a.sku};9000000;5\n`);
    const r = await importMsrp({ url, file, dryRun: true, log: () => {} });
    expect(r.updated).toBe(1);
    expect(await product(a.sku)).toEqual({ list_price: "7000000", max_discount_pct: null });
  });

  it("an invalid file writes nothing at all", async () => {
    const a = await createProduct({ listPrice: 7_000_000 });
    const file = await csv("bad.csv", `sku;msrp;max_discount_pct\n${a.sku};9000000;5\nX;abc;5\n`);
    await expect(importMsrp({ url, file, log: () => {} })).rejects.toThrow(/line 3/);
    expect((await product(a.sku)).list_price).toBe("7000000");
  });
});
