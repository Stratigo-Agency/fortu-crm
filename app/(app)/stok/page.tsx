import { Download } from "lucide-react";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { count, dayMonth, decimal } from "@/lib/format";
import { canOpenStock } from "@/lib/shell";
import { parseStockFilter, STOCK_LINES, type StockFilter, type StockRow, stockHref, stockRows, stockSummary } from "@/lib/stock";
import { body, PageHeader, PageSkeleton, secondaryButton, Stat, StatStrip } from "../PageHeader";
import { StockFilters } from "./StockFilters";

type Search = Promise<{ lini?: string | string[]; berisiko?: string | string[] }>;

export default function Page({ searchParams }: { searchParams: Search }) {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const dash = "—";
const th = "px-3 py-2 text-right font-semibold";
const td = "tabular px-3 py-3 text-right";

function Flags({ r }: { r: StockRow }) {
  if (!r.coverShort && !r.poExceedsStock) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {r.coverShort && <span className="rounded-full bg-late-bg px-2 py-0.5 text-xs font-semibold text-late">{t("stok.flagShort")}</span>}
      {r.poExceedsStock && <span className="rounded-full bg-late-bg px-2 py-0.5 text-xs font-semibold text-late">{t("stok.flagPo")}</span>}
    </span>
  );
}

const cover = (r: StockRow) => (r.coverMonths === null ? dash : t("stok.coverValue", { n: decimal(r.coverMonths) }));

function Sku({ r }: { r: StockRow }) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-xs text-slate">{r.sku}</span>
        <span className="font-semibold text-ink">{r.name}</span>
      </span>
      <Flags r={r} />
    </>
  );
}

function StockTable({ rows }: { rows: StockRow[] }) {
  return (
    <>
      <div className="hidden md:block" role="region" aria-label={t("stok.tableLabel")}>
        <table className="w-full border-collapse text-base">
          <thead>
            <tr className="border-b border-line text-sm text-faint">
              <th className="px-3 py-2 text-left font-semibold">{t("stok.colSku")}</th>
              {(["colSold", "colPipeline", "colForecast", "colAtPo", "colStock", "colOpenPo", "colCover"] as const).map((k) => (
                <th key={k} className={th}>{t(`stok.${k}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId} className="border-b border-line">
                <td className="px-3 py-3"><Sku r={r} /></td>
                <td className={td}>{r.soldPerMonth === null ? dash : decimal(r.soldPerMonth)}</td>
                <td className={td}>{count(r.unitsInPipeline)}</td>
                <td className={td}>{decimal(r.weightedUnits)}</td>
                <td className={`${td} ${r.poExceedsStock ? "font-semibold text-late" : ""}`}>{r.unitsAtPo > 0 ? count(r.unitsAtPo) : dash}</td>
                <td className={td}>{r.stock === null ? dash : count(r.stock)}</td>
                <td className={td}>{r.openPo > 0 ? count(r.openPo) : dash}</td>
                <td className={`${td} ${r.coverShort ? "font-semibold text-late" : ""}`}>{cover(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden" aria-label={t("stok.tableLabel")}>
        {rows.map((r) => (
          <li key={r.productId} className="border-b border-line py-3">
            <Sku r={r} />
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {([
                ["colSold", r.soldPerMonth === null ? dash : decimal(r.soldPerMonth), false],
                ["colPipeline", count(r.unitsInPipeline), false],
                ["colForecast", decimal(r.weightedUnits), false],
                ["colAtPo", r.unitsAtPo > 0 ? count(r.unitsAtPo) : dash, r.poExceedsStock],
                ["colStock", r.stock === null ? dash : count(r.stock), false],
                ["colOpenPo", r.openPo > 0 ? count(r.openPo) : dash, false],
                ["colCover", cover(r), r.coverShort],
              ] as const).map(([k, v, late]) => (
                <div key={k} className="flex items-baseline justify-between gap-2">
                  <dt className="text-faint">{t(`stok.${k}`)}</dt>
                  <dd className={`tabular ${late ? "font-semibold text-late" : "text-ink"}`}>{v}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

async function Content({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  if (!canOpenStock(user)) {
    return (
      <>
        <PageHeader title={t("stok.title")} />
        <p role="alert" className="px-4 py-10 text-slate md:px-6">{t("authz.stockOnly")}</p>
      </>
    );
  }
  const filter: StockFilter = parseStockFilter(await searchParams);
  const [rows, summary] = await Promise.all([stockRows(filter), stockSummary()]);
  const lines = [
    { value: "", label: t("stok.lineAll") },
    ...STOCK_LINES.map((l) => ({ value: l, label: t(`productLine.${l}`) })),
  ];
  const empty = summary.skus === 0 || summary.lastSnapshot === null;

  return (
    <>
      <PageHeader
        title={t("stok.title")}
        meta={summary.lastSnapshot ? t("stok.subtitle", { date: dayMonth(summary.lastSnapshot) }) : t("stok.subtitleNone")}
        actions={
          !empty && (
            <a href={stockHref("/stok/ekspor", filter)} download className={secondaryButton}>
              <Download size={16} strokeWidth={1.8} aria-hidden="true" />
              {t("stok.export")}
            </a>
          )
        }
      />
      <div className={`${body} pb-10`}>
        {empty ? (
          <div className="py-16 text-center">
            <p className="text-lg font-semibold text-ink">{t("stok.emptyTitle")}</p>
            <p className="mt-1 text-slate">{t("stok.emptyBody")}</p>
          </div>
        ) : (
          <>
            <StatStrip>
              <Stat label={t("stok.statSkus")} value={count(summary.skus)} />
              <Stat label={t("stok.statAtRisk")} value={count(summary.atRisk)} late={summary.atRisk > 0} />
              <Stat label={t("stok.statAtPo")} value={count(summary.unitsAtPo)} />
            </StatStrip>
            <div className="py-3">
              <StockFilters filter={filter} lines={lines} labels={{ line: t("stok.lineLabel"), onlyRisk: t("stok.onlyRisk") }} />
            </div>
            {rows.length === 0 ? <p className="py-6 text-slate">{t("stok.noMatch")}</p> : <StockTable rows={rows} />}
            <p className="mt-4 text-sm text-faint">{t("stok.coverHint")}</p>
          </>
        )}
      </div>
    </>
  );
}
