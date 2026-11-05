"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type CompanyDetail, INDUSTRIES } from "@/lib/contactTypes";
import { t } from "@/lib/copy";
import { rupiahShort } from "@/lib/format";
import { formatPhone } from "@/lib/ingest/phone";
import { PanelFrameDirty } from "../deal/PanelFrameDirty";
import { saveCompanyAction } from "./actions";

const field = "h-12 w-full rounded-sm border border-input bg-white px-3 text-base text-ink disabled:bg-paper";
const label = "mb-1.5 block text-base text-slate";

type Form = { name: string; industry: string; city: string; website: string };

export function CompanyForm({ company }: { company: CompanyDetail }) {
  const router = useRouter();
  const isNew = company.id === null;
  const readOnly = !company.canEdit;
  const [form, setForm] = useState<Form>({ name: company.name, industry: company.industry, city: company.city, website: company.website });
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  const dirty = JSON.stringify(form) !== baseline;
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const set = (k: keyof Form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setStatus(null);
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function save() {
    setPending(true);
    const r = await saveCompanyAction({ id: company.id, ...form }).catch(() => ({ ok: false as const, field: "form" as const, message: t("errors.generic") }));
    setPending(false);
    if (r.ok) {
      setBaseline(JSON.stringify(form));
      setErrors({});
      setStatus(t(isNew ? "perusahaan.created" : "perusahaan.saved"));
      if (isNew) router.replace(`/perusahaan?company=${r.id}`);
      else router.refresh();
    } else {
      setErrors({ [r.field]: r.message });
    }
  }

  return (
    <>
      <PanelFrameDirty dirty={dirty && !readOnly} />
      <div className="px-6 pb-4 pt-5">
        <p className="text-sm text-slate">{t("perusahaan.new")}</p>
        <h1 className="pr-14 text-2xl font-bold text-ink">{form.name || t("perusahaan.newTitle")}</h1>
      </div>
      {readOnly && (
        <p className="mx-6 mb-2 rounded-sm bg-paper px-3 py-2 text-slate" role="note">
          {t("perusahaan.viewOnly", { name: company.ownerName ?? "" })}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <fieldset disabled={readOnly || pending} className="min-w-0 border-t border-line px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label htmlFor="co-name" className={label}>{t("perusahaan.fieldName")}</label>
              <input
                id="co-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={!!errors.name || undefined}
                className={`${field} ${errors.name ? "border-2 border-navy" : ""}`}
              />
              {errors.name && (
                <p role="alert" className="mt-1.5 text-sm font-bold text-ink">
                  {errors.name}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="co-industry" className={label}>{t("perusahaan.fieldIndustry")}</label>
              <select id="co-industry" value={form.industry} onChange={(e) => set("industry", e.target.value)} className={field}>
                <option value="" />
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {t(`industry.${i}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="co-city" className={label}>{t("perusahaan.fieldCity")}</label>
              <input id="co-city" value={form.city} onChange={(e) => set("city", e.target.value)} className={field} />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="co-web" className={label}>{t("perusahaan.fieldWebsite")}</label>
              <input
                id="co-web"
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                aria-invalid={!!errors.website || undefined}
                className={`${field} ${errors.website ? "border-2 border-navy" : ""}`}
              />
              {errors.website && (
                <p role="alert" className="mt-1.5 text-sm font-bold text-ink">
                  {errors.website}
                </p>
              )}
            </div>
          </div>
        </fieldset>

        {!isNew && (
          <>
            <section className="border-t border-line px-6 py-5">
              <h2 className="mb-3 font-bold text-ink">{t("perusahaan.contacts")}</h2>
              {company.contacts.length === 0 ? (
                <p className="text-slate">{t("perusahaan.noContacts")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {company.contacts.map((c) => (
                    <li key={c.id} className="flex items-baseline justify-between gap-3">
                      <Link href={`/kontak?contact=${c.id}`} className="font-bold text-ink hover:underline">
                        {c.name ?? formatPhone(c.phone)}
                      </Link>
                      <span className="text-slate">{c.jobTitle ?? formatPhone(c.phone)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="border-t border-line px-6 py-5">
              <h2 className="mb-3 font-bold text-ink">{t("perusahaan.deals")}</h2>
              {company.deals.length === 0 ? (
                <p className="text-slate">{t("perusahaan.noDeals")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {company.deals.map((d) => (
                    <li key={d.id} className="flex items-baseline justify-between gap-3">
                      <Link href={`/deal/${d.id}`} className="font-bold text-ink hover:underline">
                        {d.name}
                      </Link>
                      <span className="tabular shrink-0 text-slate">
                        {t(`stage.${d.stageKey as "chat"}`)} · {rupiahShort(d.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {!readOnly && (
          <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-line bg-white px-6 py-4">
            {errors.form && (
              <p role="alert" className="mr-auto font-bold text-ink">
                {errors.form}
              </p>
            )}
            {status && !errors.form && (
              <p role="status" className="mr-auto text-slate">
                {status}
              </p>
            )}
            <button type="submit" disabled={pending} className="h-11 rounded-sm bg-navy px-6 text-base font-bold text-white disabled:opacity-60">
              {t("common.save")}
            </button>
          </div>
        )}
      </form>
    </>
  );
}
