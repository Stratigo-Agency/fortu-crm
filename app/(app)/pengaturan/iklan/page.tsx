import { Suspense } from "react";
import { canManageAds, getAdsConfig } from "@/lib/ads";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { relTime, rupiahShort } from "@/lib/format";
import { salesOptions } from "@/lib/salesFilter";
import { inputCls } from "../formStyles";
import { SectionForm } from "../SectionForm";
import { saveAdCodesAction, saveAdSetLinesAction, saveCampaignOwnersAction } from "./actions";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-8 md:px-8">
      <Suspense>
        <Ads />
      </Suspense>
    </main>
  );
}

const th = "px-3 py-2 text-left text-sm font-bold text-slate";
const LINES = ["IFP", "DSS", "LED"] as const;

async function Ads() {
  const user = await requireUser();
  if (!canManageAds(user)) {
    return (
      <>
        <h1 className="text-3xl font-bold text-ink">{t("iklan.title")}</h1>
        <p role="alert" className="mt-6 rounded-lg bg-white p-6 text-slate shadow-card">{t("authz.settingsOnly")}</p>
      </>
    );
  }
  const [cfg, reps] = await Promise.all([getAdsConfig(), salesOptions()]);
  const empty = cfg.campaigns.length === 0;

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-3xl font-bold text-ink">{t("iklan.title")}</h1>
        <p className="text-slate">
          {cfg.lastSync ? t("iklan.lastSync", { when: relTime(cfg.lastSync.at) }) : t("iklan.neverSynced")}
        </p>
      </div>
      {cfg.lastFailure && (
        <p role="alert" className="mt-3 rounded-lg bg-late-bg p-4 text-late">
          {t("iklan.lastFailure", { when: relTime(cfg.lastFailure.at), message: cfg.lastFailure.message })}
        </p>
      )}
      {empty ? (
        <p className="mt-6 rounded-lg bg-white p-6 text-slate shadow-card">{t("iklan.empty")}</p>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          <SectionForm id="kampanye" title={t("iklan.campaigns")} hint={t("iklan.campaignsHint")} action={saveCampaignOwnersAction}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-base">
                <thead>
                  <tr className="border-b border-line"><th className={th}>{t("iklan.colCampaign")}</th><th className={th}>{t("iklan.colOwner")}</th><th className={`${th} text-right`}>{t("iklan.colSpend")}</th></tr>
                </thead>
                <tbody>
                  {cfg.campaigns.map((c) => (
                    <tr key={c.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-bold text-ink">{c.name}</td>
                      <td className="px-3 py-2">
                        <input type="hidden" name={`orig:owner:${c.id}`} value={c.ownerId ?? ""} />
                        <select name={`owner:${c.id}`} defaultValue={c.ownerId ?? ""} aria-label={`${t("iklan.colOwner")} ${c.name}`} className={inputCls}>
                          <option value="">{t("iklan.noOwner")}</option>
                          {reps.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                        </select>
                      </td>
                      <td className="tabular px-3 py-2 text-right">{rupiahShort(c.spend30)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionForm>

          <SectionForm id="set" title={t("iklan.adSets")} hint={t("iklan.adSetsHint")} action={saveAdSetLinesAction}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-base">
                <thead>
                  <tr className="border-b border-line"><th className={th}>{t("iklan.colAdSet")}</th><th className={th}>{t("iklan.colCampaign")}</th><th className={th}>{t("iklan.colLine")}</th><th className={`${th} text-right`}>{t("iklan.colSpend")}</th></tr>
                </thead>
                <tbody>
                  {cfg.adSets.map((s) => (
                    <tr key={s.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-bold text-ink">{s.name}</td>
                      <td className="px-3 py-2 text-slate">{s.campaignName}</td>
                      <td className="px-3 py-2">
                        <input type="hidden" name={`orig:line:${s.id}`} value={s.productLine ?? ""} />
                        <select name={`line:${s.id}`} defaultValue={s.productLine ?? ""} aria-label={`${t("iklan.colLine")} ${s.name}`} className={inputCls}>
                          <option value="">{t("iklan.noLine")}</option>
                          {LINES.map((l) => <option key={l} value={l}>{t(`productLine.${l}`)}</option>)}
                        </select>
                      </td>
                      <td className="tabular px-3 py-2 text-right">{rupiahShort(s.spend30)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionForm>

          <SectionForm id="iklan" title={t("iklan.ads")} hint={t("iklan.adsHint")} action={saveAdCodesAction}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-base">
                <thead>
                  <tr className="border-b border-line"><th className={th}>{t("iklan.colAd")}</th><th className={th}>{t("iklan.colAdSet")}</th><th className={th}>{t("iklan.colCode")}</th><th className={`${th} text-right`}>{t("iklan.colSpend")}</th></tr>
                </thead>
                <tbody>
                  {cfg.ads.map((a) => (
                    <tr key={a.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-bold text-ink">{a.name}</td>
                      <td className="px-3 py-2 text-slate">{a.adSetName}</td>
                      <td className="px-3 py-2">
                        <input type="hidden" name={`orig:code:${a.id}`} value={a.code} />
                        <input name={`code:${a.id}`} defaultValue={a.code} placeholder={t("iklan.codePlaceholder")} maxLength={12} autoCapitalize="characters" aria-label={`${t("iklan.colCode")} ${a.name}`} className={`${inputCls} font-mono uppercase`} />
                      </td>
                      <td className="tabular px-3 py-2 text-right">{rupiahShort(a.spend30)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionForm>
        </div>
      )}
    </>
  );
}

