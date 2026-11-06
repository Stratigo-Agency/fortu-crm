import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { dayMonth, relTime } from "@/lib/format";
import { formatPhone } from "@/lib/ingest/phone";
import { salesOptions } from "@/lib/salesFilter";
import { graphVersion } from "@/lib/whatsapp/graph";
import { getWaLines } from "@/lib/whatsapp/lines";
import { canManageWhatsApp, signupConfigured } from "@/lib/whatsapp/onboard";
import { PageHeader, PageSkeleton } from "../../PageHeader";
import { ConnectWhatsApp } from "./ConnectWhatsApp";
import { LineTextForm, RevokeForm } from "./LineControls";

// Pengaturan › WhatsApp (admin, ceo): the reps' numbers connected to the CRM (Coexistence) and the button that
// connects one more. docs/whatsapp-coexistence.md explains it for the team (linked from nowhere in the UI).

export default function Page() {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <WhatsApp />
      </Suspense>
    </main>
  );
}

const th = "px-3 py-2 text-left text-sm font-medium text-faint";

async function WhatsApp() {
  const user = await requireUser();
  if (!canManageWhatsApp(user)) {
    return (
      <>
        <PageHeader title={t("whatsapp.title")} />
        <p role="alert" className="px-4 py-10 text-slate md:px-6">{t("authz.settingsOnly")}</p>
      </>
    );
  }
  const [lines, reps] = await Promise.all([getWaLines(), salesOptions()]);
  const configured = signupConfigured();

  return (
    <>
      <PageHeader title={t("whatsapp.title")} />
      <div className="flex flex-col gap-4 px-4 py-5 md:px-6">
        <section aria-labelledby="wa-lines-h" className="rounded-lg bg-white p-5 shadow-card">
          <h2 id="wa-lines-h" className="text-base font-semibold text-ink">{t("whatsapp.linesTitle")}</h2>
          {lines.length === 0 ? (
            <p className="mt-4 text-slate">{t("whatsapp.noLines")}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[60rem] text-base">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>{t("whatsapp.colOwner")}</th>
                    <th className={th}>{t("whatsapp.colNumber")}</th>
                    <th className={th}>{t("whatsapp.colMode")}</th>
                    <th className={th}>{t("whatsapp.colConsent")}</th>
                    <th className={th}>{t("whatsapp.colLastEvent")}</th>
                    <th className={th}>{t("whatsapp.colText")}</th>
                    <th className={th}><span className="sr-only">{t("whatsapp.revoke")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-line align-top last:border-0">
                      <td className="px-3 py-3 font-medium text-ink">{l.ownerName ?? "—"}</td>
                      <td className="tabular px-3 py-3 whitespace-nowrap">{formatPhone(l.phone)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm ${l.mode === "business_app" ? "bg-paper text-slate" : "bg-accent-soft text-accent-strong"}`}>
                          {t(`whatsapp.mode.${l.mode}`)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {l.consentAt ? t("whatsapp.consentBy", { name: l.consentBy ?? "", date: dayMonth(l.consentAt) }) : <span className="text-faint">{t("whatsapp.noConsent")}</span>}
                      </td>
                      <td className="px-3 py-3 text-slate">{l.lastEventAt ? relTime(l.lastEventAt) : t("whatsapp.never")}</td>
                      <td className="px-3 py-3">
                        {/* message text needs consent: after a withdrawal or a reconnect it starts off again */}
                        {l.consentAt ? <LineTextForm lineId={l.id} storeText={l.storeText} label={l.label} /> : <span className="text-faint">{"—"}</span>}
                      </td>
                      <td className="px-3 py-3">{l.consentAt && <RevokeForm lineId={l.id} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="wa-connect-h" className="rounded-lg bg-white p-5 shadow-card">
          <h2 id="wa-connect-h" className="text-base font-semibold text-ink">{t("whatsapp.connectTitle")}</h2>
          <div className="mt-4">
            {configured ? (
              <ConnectWhatsApp
                appId={process.env.META_APP_ID as string}
                configId={process.env.META_ES_CONFIG_ID as string}
                graphVersion={graphVersion()}
                reps={reps.map((r) => ({ id: r.id, name: r.full_name }))}
              />
            ) : (
              <p role="note" className="rounded-md bg-paper px-4 py-3 text-slate">{t("whatsapp.notConfigured")}</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
