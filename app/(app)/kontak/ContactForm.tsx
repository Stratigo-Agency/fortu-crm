"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ACTIVITY_TYPES, type ActivityType, type ContactDetail } from "@/lib/contactTypes";
import { t } from "@/lib/copy";
import { lookupCompanies } from "../deal/actions";
import { PanelFrameDirty } from "../deal/PanelFrameDirty";
import { rupiahShort, relTime } from "@/lib/format";
import { formatPhone } from "@/lib/ingest/phone";
import { logActivityAction, saveContactAction } from "./actions";

const field = "h-12 w-full rounded-sm border border-input bg-white px-3 text-base text-ink disabled:bg-paper";
const label = "mb-1.5 block text-base text-slate";
const bad = "border-2 border-navy";

type Form = { name: string; jobTitle: string; email: string; phone: string; companyName: string };

export function ContactForm({ contact }: { contact: ContactDetail }) {
  const router = useRouter();
  const isNew = contact.id === null;
  const readOnly = !contact.canEdit;
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()), []);

  const [form, setForm] = useState<Form>({
    name: contact.name,
    jobTitle: contact.jobTitle,
    email: contact.email,
    phone: contact.phone,
    companyName: contact.companyName,
  });
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  const dirty = JSON.stringify(form) !== baseline;
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const set = (key: keyof Form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setStatus(null);
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const [companyHits, setCompanyHits] = useState<{ q: string; names: string[] } | null>(null);
  useEffect(() => {
    const q = form.companyName.trim();
    if (!q || readOnly) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const names = await lookupCompanies(q).catch(() => []);
      if (!stale) setCompanyHits({ q, names });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [form.companyName, readOnly]);

  async function save() {
    setPending(true);
    const r = await saveContactAction({ id: contact.id, ...form }).catch(() => ({ ok: false as const, field: "form" as const, message: t("errors.generic") }));
    setPending(false);
    if (r.ok) {
      setBaseline(JSON.stringify(form));
      setStatus(t(isNew ? "kontak.created" : "kontak.saved"));
      setErrors({});
      if (isNew) router.replace(`/kontak?contact=${r.id}`);
      else router.refresh();
    } else {
      setErrors({ [r.field]: r.message });
    }
  }

  // --- Catat: the activity log --------------------------------------------------------------
  const [type, setType] = useState<ActivityType>("whatsapp");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [logError, setLogError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  async function log() {
    if (!contact.id) return;
    setLogging(true);
    setLogError(null);
    const r = await logActivityAction(contact.id, type, date, note).catch(() => ({ ok: false as const, field: "form" as const, message: t("errors.generic") }));
    setLogging(false);
    if (r.ok) {
      setNote("");
      setStatus(t("kontak.logged"));
      router.refresh();
    } else {
      setLogError(r.message);
    }
  }

  return (
    <>
      <PanelFrameDirty dirty={dirty && !readOnly} />
      <div className="px-6 pb-4 pt-5">
        <p className="text-sm text-slate">{t("kontak.new")}</p>
        <h1 className="pr-14 text-2xl font-bold text-ink">{form.name || (isNew ? t("kontak.newTitle") : formatPhone(form.phone))}</h1>
        {!isNew && contact.lastChatAt && (
          <p className="mt-1 text-slate">
            {t("kontak.colLast")}: {relTime(contact.lastChatAt)}
          </p>
        )}
      </div>

      {readOnly && (
        <p className="mx-6 mb-2 rounded-sm bg-paper px-3 py-2 text-slate" role="note">
          {t("kontak.viewOnly", { name: contact.ownerName ?? "" })}
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
            <div>
              <label htmlFor="c-name" className={label}>{t("kontak.colName")}</label>
              <input id="c-name" value={form.name} onChange={(e) => set("name", e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="c-job" className={label}>{t("kontak.title_field")}</label>
              <input id="c-job" value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="c-company" className={label}>{t("kontak.colCompany")}</label>
              <input id="c-company" list="c-company-list" autoComplete="off" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} className={field} />
              <datalist id="c-company-list">
                {companyHits?.names.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="c-phone" className={label}>{t("kontak.colPhone")}</label>
              <input
                id="c-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                aria-invalid={!!errors.phone || undefined}
                className={`${field} ${errors.phone ? bad : ""}`}
              />
              {errors.phone && (
                <p role="alert" className="mt-1.5 text-sm font-bold text-ink">
                  {errors.phone}
                </p>
              )}
            </div>
            <div className="md:col-span-2">
              <label htmlFor="c-email" className={label}>{t("kontak.fieldEmail")}</label>
              <input
                id="c-email"
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                aria-invalid={!!errors.email || undefined}
                className={`${field} ${errors.email ? bad : ""}`}
              />
              {errors.email && (
                <p role="alert" className="mt-1.5 text-sm font-bold text-ink">
                  {errors.email}
                </p>
              )}
            </div>
          </div>
        </fieldset>

        {/* ---- Aktivitas (Catat) ----------------------------------------------------------- */}
        {!isNew && (
          <section className="border-t border-line px-6 py-5">
            <h2 className="mb-4 font-bold text-ink">{t("kontak.activity")}</h2>
            {!readOnly && (
              <div className="mb-5 flex flex-col gap-3">
                <fieldset>
                  <legend className="sr-only">{t("kontak.activity")}</legend>
                  <div className="flex flex-wrap gap-2">
                    {ACTIVITY_TYPES.map((a) => (
                      <label
                        key={a}
                        className="flex min-h-11 cursor-pointer items-center rounded-sm border border-line bg-white px-3.5 text-base text-ink has-checked:border-navy has-checked:bg-navy has-checked:font-bold has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-navy"
                      >
                        <input type="radio" name="activity-type" value={a} checked={type === a} onChange={() => setType(a)} className="sr-only" />
                        {t(`kontak.activityTypes.${a}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-3 md:grid-cols-[200px_1fr]">
                  <div>
                    <label htmlFor="a-date" className={label}>{t("kontak.date")}</label>
                    <input id="a-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void log(); } }} className={field} />
                  </div>
                  <div>
                    <label htmlFor="a-note" className={label}>{t("deal.notes")}</label>
                    <input id="a-note" value={note} placeholder={t("kontak.activityPlaceholder")} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void log(); } }} className={field} />
                  </div>
                </div>
                {logError && (
                  <p role="alert" className="font-bold text-ink">
                    {logError}
                  </p>
                )}
                <button type="button" onClick={log} disabled={logging} className="h-11 self-start rounded-sm bg-navy px-6 text-base font-bold text-white disabled:opacity-60">
                  {t("kontak.log")}
                </button>
              </div>
            )}
            {contact.timeline.length === 0 ? (
              <p className="text-slate">{t("kontak.noActivity")}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {contact.timeline.map((i) => (
                  <li key={i.id}>
                    <p className="font-bold text-ink">
                      {i.kind === "lead" ? t("kontak.timelineLead") : t(`kontak.activityTypes.${i.type as ActivityType}`)}
                    </p>
                    {i.text && <p className="text-ink">{i.text}</p>}
                    <p className="text-sm text-slate">
                      {i.by ? `${i.by} · ` : ""}
                      {relTime(i.at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ---- Deal ------------------------------------------------------------------------ */}
        {!isNew && (
          <section className="border-t border-line px-6 py-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-bold text-ink">{t("kontak.deals")}</h2>
              {!readOnly && (
                <Link href={`/deal/new?contact=${contact.id}`} className="flex h-11 items-center gap-2 rounded-sm border border-line bg-white px-4 font-bold text-ink">
                  <span aria-hidden="true">+</span> {t("pipeline.newDeal")}
                </Link>
              )}
            </div>
            {contact.deals.length === 0 ? (
              <p className="text-slate">{t("kontak.noDeals")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {contact.deals.map((d) => (
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
