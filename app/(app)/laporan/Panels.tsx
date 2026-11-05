import { t, type MessageKey } from "@/lib/copy";
import { count, decimal, rupiahShort } from "@/lib/format";
import type { AdsToCrm, DemoEffect, LostReasonRow, SkuRow, SourceRow } from "@/lib/reports";

type SourceKey = MessageKey extends `sourceChannel.${infer K}` ? K : never;
type ReasonKey = MessageKey extends `lostReason.${infer K}` ? K : never;

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-paper px-4 py-3">
      <p className="tabular text-2xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-slate">{label}</p>
    </div>
  );
}

/** Dari iklan ke CRM: what Meta says reached WhatsApp against what the team logged, last 7 full days. */
export function AdsToCrmCard({ ads }: { ads: AdsToCrm }) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-card" aria-label={t("laporan.adsToCrm")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t("laporan.adsToCrm")}</h2>
        <p className="text-sm text-slate">{t("laporan.last7")}</p>
      </div>
      {!ads.hasData ? (
        <p className="mt-4 text-slate">{t("laporan.adsWaiting")}</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Tile value={count(ads.clicks)} label={t("laporan.adsClicks")} />
            <Tile value={count(ads.chats)} label={t("laporan.adsChats")} />
            <Tile value={count(ads.logged)} label={t("laporan.adsLogged", { pct: ads.loggedPct === null ? "—" : `${ads.loggedPct}%` })} />
          </div>
          <p className="mt-4 text-slate">
            {ads.missing === 0
              ? t("laporan.adsNoneMissing")
              : `${t("laporan.adsMissing", { n: count(ads.missing) })}${ads.topMissingAd ? ` ${t("laporan.adsMostMissing", { ad: ads.topMissingAd.name })}` : ""}`}
          </p>
        </>
      )}
    </section>
  );
}

const th = "px-3 py-2 text-right font-semibold";
const td = "tabular px-3 py-3 text-right";
const thTight = "px-2 py-2 text-right font-semibold";
const tdTight = "tabular px-2 py-3 text-right";
const dash = "—";

/** Permintaan per SKU: units in open deals, weighted by stage, at PO and done this month (for stock planning). */
export function SkuTable({ rows }: { rows: SkuRow[] }) {
  return (
    <section className="min-w-0 rounded-lg bg-white p-5 shadow-card xl:col-span-2" aria-label={t("laporan.skuDemand")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t("laporan.skuDemand")}</h2>
        <p className="text-sm text-slate">{t("laporan.skuDemandHint")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-slate">{t("laporan.noRows")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-base">
            <thead>
              <tr className="border-b border-line text-sm text-faint">
                <th className="px-3 py-2 text-left font-semibold">{t("laporan.colSku")}</th>
                {(["colInPipeline", "colEstimate", "colAtPo", "colDone"] as const).map((k) => (
                  <th key={k} className={th}>{t(`laporan.${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId} className="border-b border-line last:border-0">
                  <td className="px-3 py-3">
                    <span className="mr-2 rounded-sm border border-line px-1.5 py-0.5 font-mono text-xs text-slate">{r.sku}</span>
                    <span className="font-semibold text-ink">{r.name}</span>
                  </td>
                  <td className={td}>{count(r.unitsInPipeline)}</td>
                  <td className={td}>{decimal(r.weightedUnits)}</td>
                  <td className={td}>{r.unitsAtPo > 0 ? count(r.unitsAtPo) : dash}</td>
                  <td className={td}>{r.doneUnitsMonth > 0 ? count(r.doneUnitsMonth) : dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Sumber prospek: deals created in the last 90 days by lead source. */
export function SourcesTable({ rows }: { rows: SourceRow[] }) {
  return (
    <section className="min-w-0 rounded-lg bg-white p-5 shadow-card" aria-label={t("laporan.sources")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t("laporan.sources")}</h2>
        <p className="text-sm text-slate">{t("laporan.last90")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-slate">{t("laporan.noRows")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-base">
            <thead>
              <tr className="border-b border-line text-sm text-faint">
                <th className="px-2 py-2 text-left font-semibold">{t("laporan.colSource")}</th>
                {(["colNewDeals", "colDoneCount", "colDoneValue", "colRate"] as const).map((k) => (
                  <th key={k} className={thTight}>{t(`laporan.${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.source} className="border-b border-line last:border-0">
                  <td className="px-2 py-3 text-ink">{t(`sourceChannel.${r.source as SourceKey}`)}</td>
                  <td className={tdTight}>{count(r.newDeals)}</td>
                  <td className={tdTight}>{count(r.won)}</td>
                  <td className={tdTight}>{r.won > 0 ? rupiahShort(r.wonAmount) : dash}</td>
                  <td className={tdTight}>{r.winRatePct === null ? dash : `${r.winRatePct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DemoTile({ label, d }: { label: string; d: DemoEffect }) {
  return (
    <div className="rounded-lg bg-paper px-4 py-3">
      <p className="text-slate">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold text-ink">{d.ratePct === null ? dash : `${d.ratePct}%`}</p>
      <p className="mt-1 text-sm text-slate">{d.closed === 0 ? t("laporan.winRateNone") : t("laporan.xOfY", { x: d.won, y: d.closed })}</p>
    </div>
  );
}

/** Demo dan alasan lost: win rate with and without a demo, and why deals were lost (90 days). */
export function DemoLostCard({ demo, reasons }: { demo: { with: DemoEffect; without: DemoEffect }; reasons: LostReasonRow[] }) {
  const max = Math.max(...reasons.map((r) => r.deals), 1);
  return (
    <section className="rounded-lg bg-white p-5 shadow-card" aria-label={t("laporan.demoLost")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t("laporan.demoLost")}</h2>
        <p className="text-sm text-slate">{t("laporan.last90")}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <DemoTile label={t("laporan.withDemo")} d={demo.with} />
        <DemoTile label={t("laporan.withoutDemo")} d={demo.without} />
      </div>
      <div className="mt-5 flex items-baseline justify-between border-b border-line pb-2 text-sm font-semibold text-slate">
        <span>{t("laporan.colReason")}</span>
        <span>{t("laporan.colDeals")}</span>
      </div>
      {reasons.length === 0 ? (
        <p className="mt-3 text-slate">{t("laporan.noRows")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {reasons.map((r) => (
            <li key={r.reason} className="flex items-center justify-between gap-3 py-3">
              <span className="text-ink">{t(`lostReason.${r.reason as ReasonKey}`)}</span>
              <span className="tabular flex items-center gap-3 text-ink">
                <span className="h-2 origin-left animate-grow-x rounded-full bg-pink" style={{ width: `${Math.max(6, (r.deals / max) * 72)}px` }} aria-hidden="true" />
                {r.deals}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
