import { t } from "@/lib/copy";
import { count } from "@/lib/format";
import type { AdsToCrm } from "@/lib/reports";

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-paper px-4 py-3">
      <p className="tabular text-3xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-slate">{label}</p>
    </div>
  );
}

/** Dari iklan ke CRM: what Meta says reached WhatsApp against what the team logged, last 7 full days. */
export function AdsToCrmCard({ ads }: { ads: AdsToCrm }) {
  return (
    <section className="rounded-lg bg-white p-6 shadow-card" aria-label={t("laporan.adsToCrm")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">{t("laporan.adsToCrm")}</h2>
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
