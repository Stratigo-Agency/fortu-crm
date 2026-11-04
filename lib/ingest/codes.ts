// Attribution codes in a customer's first message (docs/INTEGRATIONS.md · Attribution codes).
// Pure, so Tambah cepat can use it in the browser too.

const AD_CODE = /\[([A-Z])-(IFP|DSS|LED)-(\d{2})\]/i;
const CLICK_CODE = /#([A-Z0-9]{4})\b/i;

export type Codes = { adCode?: string; clickCode?: string };

/** "[f-ifp-01] halo #w7k2" → { adCode: "F-IFP-01", clickCode: "W7K2" }. First match of each wins. */
export function parseCodes(text: string | null | undefined): Codes {
  const codes: Codes = {};
  if (!text) return codes;
  const ad = AD_CODE.exec(text);
  if (ad) codes.adCode = `${ad[1]}-${ad[2]}-${ad[3]}`.toUpperCase();
  const click = CLICK_CODE.exec(text);
  if (click) codes.clickCode = click[1].toUpperCase();
  return codes;
}
