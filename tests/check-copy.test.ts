import { describe, expect, it } from "vitest";
import { checkSource } from "../scripts/check-copy.mjs";

const check = (src: string) => checkSource("x.tsx", src).map((p: { text: string }) => p.text);

describe("checkSource", () => {
  it("flags JSX text and string literals in UI attributes", () => {
    expect(check(`<p>Save changes</p>`)).toEqual(["Save changes"]);
    expect(check(`<p>{"Loading"}</p>`)).toEqual(["Loading"]);
    expect(check(`<input placeholder="Search" />`)).toEqual(['placeholder="Search"']);
    expect(check(`<button aria-label={"Close"} title='Tutup' />`)).toEqual(['aria-label="Close"', 'title="Tutup"']);
  });

  it("allows t(), punctuation, numbers, the stage words and the brand", () => {
    expect(
      check(`<div title={t("x")}><p>{t("y")} · 3 · +</p><span>Quotation</span><img alt="Fortu" /></div>`),
    ).toEqual([]);
    expect(check(`<span> Done deal </span>`)).toEqual([]);
  });

  it("flags literals inside ternaries, fallbacks, templates and fragments", () => {
    expect(check(`<p>{ok ? "Save now" : t("x")}</p>`)).toEqual(["Save now"]);
    expect(check(`<p>{name || "Unknown"}</p>`)).toEqual(["Unknown"]);
    expect(check(`<p>{name ?? ("Nobody")}</p>`)).toEqual(["Nobody"]);
    expect(check("<p>{`Save ${n} items`}</p>")).toEqual(["Save … items"]);
    expect(check(`<>{"Save now"}</>`)).toEqual(["Save now"]);
    expect(check(`<button aria-label={x ? "Close" : "Open"} />`)).toEqual(['aria-label="Close"', 'aria-label="Open"']);
    expect(check("<input placeholder={`Search ${x}`} />")).toEqual(['placeholder="Search …"']);
  });

  it("flags text props on our own components", () => {
    expect(check(`<Btn label="Save now" emptyText={"No deals"} />`)).toEqual(['label="Save now"', 'emptyText="No deals"']);
    expect(check(`<Btn label={t("x")} aria-labelledby="title-id" />`)).toEqual([]);
  });

  it("ignores non-UI attributes like className and type", () => {
    expect(check(`<input className="h-11 w-full" type="email" name="email" />`)).toEqual([]);
  });
});
