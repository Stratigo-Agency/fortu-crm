import { Suspense } from "react";
import { canManageAds, getAdsConfig } from "@/lib/ads";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { relTime, rupiahShort } from "@/lib/format";
import { salesOptions } from "@/lib/salesFilter";
import { inputCls } from "../formStyles";
import { Select } from "../../ui/Select";
import { PageHeader, PageSkeleton } from "../../PageHeader";
import { SectionForm } from "../SectionForm";
import { saveAdCodesAction, saveAdSetLinesAction, saveCampaignOwnersAction } from "./actions";

export default function Page() {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Ads />
      </Suspense>
    </main>
  );
}

const th = "px-3 py-2 text-left text-sm font-medium text-faint";
const LINES = ["IFP", "DSS", "LED"] as const;

async function Ads() {
  const user = await requireUser();
  if (!canManageAds(user)) {
    return (
      <>
        <PageHeader title={t("iklan.title")} />
        <p role="alert" className="px-4 py-10 text-slate md:px-6">{t("authz.settingsOnly")}</p>
      </>
    );
  }
  const [cfg, reps] = await Promise.all([getAdsConfig(), salesOptions()]);
  const empty = cfg.campaigns.length === 0;

  return (
    <>
      <PageHeader
        title={t("iklan.title")}
        meta={cfg.lastSync ? t("iklan.lastSync", { when: relTime(cfg.lastSync.at) }) : t("iklan.neverSynced")}
      />
      <div className="px-4 py-5 md:px-6">
      {cfg.lastFailure && (
        <p role="alert" className="mb-4 rounded-md bg-late-bg px-4 py-3 text-late">
          {t("iklan.lastFailure", { when: relTime(cfg.lastFailure.at), message: cfg.lastFailure.message })}
        </p>
      )}
      {empty ? (
        <p className="py-10 text-slate">{t("iklan.empty")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <SectionForm id="kampanye" title={t("iklan.campaigns")} hint={t("iklan.campaignsHint")} action={saveCampaignOwnersAction}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-base">
                <thead>
                  <tr className="border-b border-line"><th className={th}>{t("iklan.colCampaign")}</th><th className={th}>{t("iklan.colOwner")}</th><th className={`${th} text-right`}>{t("iklan.colSpend")}</th></tr>
                </thead>
                <tbody>
                  {cfg.campaigns.map((c) => (
                    <tr key={c.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-medium text-ink">{c.name}</td>
                      <td className="px-3 py-2">
                        <input type="hidden" name={`orig:owner:${c.id}`} value={c.ownerId ?? ""} />
                        <Select
                          name={`owner:${c.id}`}
                          defaultValue={c.ownerId ?? ""}
                          label={`${t("iklan.colOwner")} ${c.name}`}
                          options={[{ value: "", label: t("iklan.noOwner") }, ...reps.map((r) => ({ value: r.id, label: r.full_name }))]}
                          className="min-w-40"
                        />
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
                      <td className="px-3 py-2 font-medium text-ink">{s.name}</td>
                      <td className="px-3 py-2 text-slate">{s.campaignName}</td>
                      <td className="px-3 py-2">
                        <input type="hidden" name={`orig:line:${s.id}`} value={s.productLine ?? ""} />
                        <Select
                          name={`line:${s.id}`}
                          defaultValue={s.productLine ?? ""}
                          label={`${t("iklan.colLine")} ${s.name}`}
                          options={[{ value: "", label: t("iklan.noLine") }, ...LINES.map((l) => ({ value: l, label: t(`productLine.${l}`) }))]}
                          className="min-w-36"
                        />
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
              <table className="w-full min-w-[48rem] text-base">
                <thead>
                  <tr className="border-b border-line"><th className={th}>{t("iklan.colAd")}</th><th className={th}>{t("iklan.colAdSet")}</th><th className={th}>{t("iklan.colCode")}</th><th className={`${th} text-right`}>{t("iklan.colLeads7")}</th><th className={`${th} text-right`}>{t("iklan.colSpend")}</th></tr>
                </thead>
                <tbody>
                  {cfg.ads.map((a) => (
                    <tr key={a.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-medium text-ink">{a.name}</td>
                      <td className="px-3 py-2 text-slate">{a.adSetName}</td>
                      <td className="px-3 py-2">
                        <input type="hidden" name={`orig:code:${a.id}`} value={a.code} />
                        <input name={`code:${a.id}`} defaultValue={a.code} placeholder={t("iklan.codePlaceholder")} maxLength={12} autoCapitalize="characters" aria-label={`${t("iklan.colCode")} ${a.name}`} className={`${inputCls} min-w-36 font-mono uppercase`} />
                      </td>
                      <td className={`tabular px-3 py-2 text-right ${a.code && a.leads7 === 0 ? "text-faint" : ""}`}>{a.code ? a.leads7 : "–"}</td>
                      <td className="tabular px-3 py-2 text-right">{rupiahShort(a.spend30)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionForm>
        </div>
      )}
      </div>
    </>
  );
}

