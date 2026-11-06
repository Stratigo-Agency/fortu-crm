"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { t } from "@/lib/copy";
import { Select } from "../ui/Select";
import { Suggest } from "../ui/Suggest";
import type { DealDetail, DealKind, DealSettings, HistoryItem, LeadTrace, ProductOption } from "@/lib/dealTypes";
import { DEAL_KINDS } from "@/lib/dealTypes";
import { dayMonth, dayMonthTime, relTime, rupiah } from "@/lib/format";
import { formatPhone } from "@/lib/ingest/phone";
import { NOT_FIT_REASONS } from "@/lib/leadReasons";
import { STAGE_KEYS, type StageKey, type StageRule } from "@/lib/pipelineTypes";
import { missingRules, RULE_FIELDS } from "@/lib/stageRules";
import { lookupCompanies, lookupContact, lookupParents, saveDealAction } from "./actions";
import { DealHeader } from "./DealHeader";
import { useDealFrame } from "./PanelFrame";

// Sales competitors the team already names; the field takes any text.
const COMPETITORS = ["Vannoe", "Zelt", "InnoGraph"];
const LOST_REASONS = [...NOT_FIT_REASONS, "kompetitor", "stock_leadtime"] as const;

type Line = { key: number; productId: string; qty: string; unitPrice: string };

type Form = {
  name: string;
  kind: DealKind;
  parentDealId: string;
  stageKey: StageKey;
  ownerId: string;
  companyName: string;
  contactName: string;
  phone: string;
  expectedCloseDate: string;
  nextStep: string;
  nextStepDate: string;
  demoDate: string;
  paidDate: string;
  lostReason: string;
  competitor: string;
  lostNote: string;
  estAmount: string;
  note: string;
  lines: Line[];
};

type Errors = Partial<Record<string, string>>;

type Props = {
  deal: DealDetail;
  products: ProductOption[];
  owners: { id: string; full_name: string }[];
  settings: DealSettings;
  /** sales lead, CEO and admin may hand the deal to someone else */
  canReassign: boolean;
  /** the prospect this new deal comes from (Jadikan deal) */
  fromLeadId: string | null;
  /** from a failed drag: the stage that was wanted and the rule that stopped it */
  wantedStage: StageKey | null;
  missingRule: StageRule | null;
  parentOptions: { id: string; name: string }[];
};

const field = "h-12 w-full rounded-sm border border-input bg-white px-3 text-base text-ink disabled:bg-paper desk:h-10 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15";
const label = "mb-1.5 block text-sm font-medium text-slate";
const bad = "border-2 border-navy";

let lineKey = 0;
const digits = (v: string) => v.replace(/\D/g, "");
const money = (v: string) => (v ? new Intl.NumberFormat("id-ID").format(Number(v)) : "");
const toLine = (l: { productId: string; qty: number; unitPrice: number }): Line => ({
  key: ++lineKey,
  productId: l.productId,
  qty: String(l.qty),
  unitPrice: String(l.unitPrice),
});

function initialForm(d: DealDetail, wanted: StageKey | null, today: string): Form {
  const stageKey = wanted ?? d.stageKey;
  return {
    name: d.name,
    kind: d.kind,
    parentDealId: d.parentDealId ?? "",
    stageKey,
    ownerId: d.ownerId,
    companyName: d.companyName,
    contactName: d.contactName,
    phone: d.phone,
    expectedCloseDate: d.expectedCloseDate,
    nextStep: d.nextStep,
    nextStepDate: d.nextStepDate,
    demoDate: d.demoDate,
    // the payment date is only Done deal's; any other stage starts without one
    paidDate: stageKey === "done" ? (d.stageKey === "done" ? d.paidDate : today) : "",
    lostReason: d.lostReason,
    competitor: d.competitor,
    lostNote: d.lostNote,
    estAmount: d.estAmount ? String(d.estAmount) : "",
    note: "",
    lines: d.lines.map(toLine),
  };
}

const ruleMessage = (rule: StageRule) => t(`stageRule.${rule}`);

export function DealForm({ deal, products, owners, settings, canReassign, fromLeadId, wantedStage, missingRule, parentOptions }: Props) {
  const router = useRouter();
  const frame = useDealFrame();
  const isNew = deal.id === null;
  const readOnly = !deal.canEdit;
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()), []);

  const [form, setForm] = useState<Form>(() => initialForm(deal, wantedStage, today));
  const [errors, setErrors] = useState<Errors>(() => {
    // a drag that a stage rule stopped: mark what is missing
    if (!missingRule) return {};
    const out: Errors = {};
    for (const f of RULE_FIELDS[missingRule]) out[f] = ruleMessage(missingRule);
    return out;
  });
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // what the form looked like when it was last saved or loaded
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  const dirty = JSON.stringify(form) !== baseline;
  useEffect(() => frame.setDirty(dirty && !readOnly), [dirty, readOnly, frame]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setStatus(null);
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  // --- company and contact lookups -----------------------------------------------------------
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
  const companyIsNew =
    !!form.companyName.trim() &&
    companyHits?.q === form.companyName.trim() &&
    !companyHits.names.some((n) => n.toLowerCase() === form.companyName.trim().toLowerCase());

  const [phoneHit, setPhoneHit] = useState<{ phone: string; name: string | null; rep: string | null } | null>(null);
  async function checkPhone() {
    if (readOnly || !form.phone.trim()) return;
    const hit = await lookupContact(form.phone).catch(() => null);
    setPhoneHit(hit ? { phone: form.phone, name: hit.name, rep: hit.rep } : null);
    if (hit?.name && !form.contactName.trim()) set("contactName", hit.name);
  }
  // A contact that already exists keeps its name here (it is changed in Kontak); a deal made from a
  // prospect keeps the prospect's contact and number.
  const contactKnown = !!phoneHit?.name || (!isNew && form.phone === deal.phone && !!deal.contactName);
  const contactLocked = !!fromLeadId || contactKnown;
  const phoneNote =
    phoneHit && phoneHit.phone === form.phone && phoneHit.rep && (isNew || phoneHit.rep !== deal.ownerName)
      ? t("deal.phoneTaken", { name: phoneHit.name ?? formatPhone(form.phone), rep: phoneHit.rep })
      : null;

  const [parents, setParents] = useState(parentOptions);
  useEffect(() => {
    if (form.kind === "new" || readOnly) return;
    let stale = false;
    lookupParents(form.companyName).then((p) => !stale && setParents(p)).catch(() => {});
    return () => {
      stale = true;
    };
  }, [form.kind, form.companyName, readOnly]);

  // --- product lines (a live preview: the saved amount always comes from the database) -------
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const parsed = form.lines.map((l) => ({ ...l, qtyN: Number(l.qty) || 0, priceN: Number(l.unitPrice) || 0 }));
  // preview only: deals.amount is computed by the database trigger from the saved lines
  const previewTotal = parsed.reduce((sum, l) => sum + l.qtyN * l.priceN, 0);
  const previewUnits = parsed.reduce((sum, l) => sum + (productById.get(l.productId)?.countsAsScreen ? l.qtyN : 0), 0);
  const pricedLines = parsed.filter((l) => l.productId && l.qtyN > 0 && l.priceN > 0).length;
  const isProject =
    previewUnits >= settings.projectMinUnits || (form.lines.length ? previewTotal : Number(form.estAmount) || 0) >= settings.projectMinAmount;

  function addLine() {
    setForm((f) => ({ ...f, lines: [...f.lines, { key: ++lineKey, productId: "", qty: "1", unitPrice: "" }] }));
    setErrors((e) => ({ ...e, lines: undefined }));
  }
  function setLine(key: number, patch: Partial<Line>) {
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
    setStatus(null);
    setErrors((e) => ({ ...e, lines: undefined }));
  }
  function pickProduct(key: number, productId: string) {
    const p = productById.get(productId);
    // the price starts at MSRP and can be changed
    setLine(key, { productId, unitPrice: p?.msrp ? String(p.msrp) : "" });
  }
  function removeLine(key: number) {
    setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.key !== key) }));
  }

  function lineNote(l: (typeof parsed)[number]): { text: string; late: boolean } | null {
    const p = productById.get(l.productId);
    if (!p || !l.priceN) return null;
    if (!p.msrp) return { text: t("deal.noMsrp"), late: false };
    const pct = Math.round((1 - l.priceN / p.msrp) * 1000) / 10;
    if (Math.abs(pct) < 0.05) return { text: t("deal.atMsrp"), late: false };
    if (pct <= 0) return null;
    const over = pct > p.maxDiscountPct + 0.05;
    const text = t("deal.discount", { pct: String(pct).replace(".", ","), msrp: rupiah(p.msrp) });
    return { text: over ? `${text} ${t("deal.discountOver", { max: p.maxDiscountPct })}` : text, late: over };
  }

  // --- stage --------------------------------------------------------------------------------
  function chooseStage(key: StageKey) {
    setForm((f) => ({
      ...f,
      stageKey: key,
      // Lost → Done must not carry the lost date: Done deal starts at today unless it already was Done
      paidDate: key === "done" ? (deal.stageKey === "done" ? deal.paidDate : today) : "",
    }));
    setStatus(null);
    setErrors({});
  }

  // --- save ---------------------------------------------------------------------------------
  async function save() {
    setStatus(null);
    const found: Errors = {};
    if (!form.name.trim()) found.name = t("deal.nameRequired");
    if (!form.phone.trim()) found.phone = t("quickAdd.invalidPhone");
    if (form.kind !== "new" && !form.parentDealId) found.parentDealId = t("deal.parentRequired");
    if (form.lines.some((l) => !l.productId || !(Number(l.qty) > 0) || l.unitPrice === "")) found.lines = t("deal.linesInvalid");
    const rules = missingRules({
      stageKey: form.stageKey,
      nextStep: form.nextStep,
      nextStepDate: form.nextStepDate,
      expectedCloseDate: form.expectedCloseDate,
      lostReason: form.lostReason,
      pricedLines,
    });
    for (const rule of rules) for (const f of RULE_FIELDS[rule]) found[f] = ruleMessage(rule);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    setPending(true);
    const result = await saveDealAction({
      id: deal.id,
      ...form,
      parentDealId: form.parentDealId || null,
      estAmount: Number(form.estAmount) || 0,
      lines: form.lines.map((l) => ({ productId: l.productId, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
      fromLeadId,
    }).catch(() => ({ ok: false as const, field: "form" as const, message: t("deal.saveFailed") }));
    setPending(false);

    if (result.ok) {
      setBaseline(JSON.stringify({ ...form, note: "" }));
      setForm((f) => ({ ...f, note: "" }));
      setErrors({});
      setStatus(t(isNew ? "deal.created" : "deal.saved"));
      if (isNew) router.replace(`/deal/${result.id}`);
      else router.refresh();
    } else if ("rule" in result) {
      const out: Errors = {};
      for (const f of RULE_FIELDS[result.rule]) out[f] = ruleMessage(result.rule);
      setErrors(out);
    } else {
      setErrors({ [result.field === "parent" ? "parentDealId" : result.field]: result.message });
    }
  }

  const closed = form.stageKey === "done" || form.stageKey === "lost";
  const rowsShown = parsed;

  return (
    <>
      <DealHeader
        kind={t("deal.kind")}
        name={form.name}
        stageKey={form.stageKey}
        amount={deal.amount}
        weightedAmount={deal.weightedAmount}
        daysInStage={deal.daysInStage}
        isNew={isNew}
        onStage={chooseStage}
        disabled={readOnly}
        rules={{
          nextStep: form.nextStep,
          nextStepDate: form.nextStepDate,
          expectedCloseDate: form.expectedCloseDate,
          lostReason: form.lostReason,
          pricedLines,
        }}
      />

      {readOnly && (
        <p className="mx-6 mb-2 flex items-center gap-2 rounded-sm bg-paper px-3 py-2 text-slate" role="note">
          <Lock />
          {t("deal.viewOnly", { name: deal.ownerName ?? "" })}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <fieldset disabled={readOnly || pending} className="min-w-0">
          {/* ---- Deal ------------------------------------------------------------------------ */}
          <Section title={t("deal.kind")}>
            <Field id="name" label={t("deal.name")} error={errors.name}>
              <input
                id="name"
                value={form.name}
                placeholder={t("deal.namePlaceholder")}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={!!errors.name || undefined}
                className={`${field} ${errors.name ? bad : ""}`}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field id="company" label={t("deal.company")} hint={companyIsNew ? t("deal.companyNew") : undefined}>
                <Suggest
                  id="company"
                  value={form.companyName}
                  onChange={(v) => set("companyName", v)}
                  suggestions={companyHits?.names ?? []}
                  className={field}
                />
              </Field>
              <Field id="owner" label={t("deal.owner")}>
                <Select
                  id="owner"
                  value={form.ownerId}
                  disabled={!canReassign}
                  onChange={(v) => set("ownerId", v)}
                  options={[
                    ...(owners.some((o) => o.id === form.ownerId) ? [] : [{ value: form.ownerId, label: deal.ownerName ?? "—" }]),
                    ...owners.map((o) => ({ value: o.id, label: o.full_name })),
                  ]}
                />
              </Field>
              <Field id="contact" label={t("deal.contact")}>
                <input
                  id="contact"
                  autoComplete="off"
                  value={form.contactName}
                  disabled={contactLocked}
                  onChange={(e) => set("contactName", e.target.value)}
                  className={field}
                />
              </Field>
              <Field id="phone" label={t("deal.phone")} error={errors.phone} hint={phoneNote ?? undefined}>
                <div className="flex gap-2">
                  <input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    value={form.phone}
                    disabled={!!fromLeadId}
                    onChange={(e) => set("phone", e.target.value)}
                    onBlur={checkPhone}
                    aria-invalid={!!errors.phone || undefined}
                    className={`${field} ${errors.phone ? bad : ""}`}
                  />
                  {form.phone && digits(form.phone).length >= 8 && (
                    <a
                      href={`https://wa.me/${waNumber(form.phone)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-12 shrink-0 items-center rounded-full border border-line bg-white px-4 font-medium text-ink hover:bg-paper desk:h-10"
                    >
                      {t("deal.chat")}
                    </a>
                  )}
                </div>
              </Field>
              <div role="group" aria-labelledby="lead-source">
                <p id="lead-source" className={label}>
                  {t("deal.leadSource")}
                </p>
                <LeadSource deal={deal} />
              </div>
              <Field id="close" label={t("deal.closeDate")} error={errors.expectedCloseDate}>
                <input
                  id="close"
                  type="date"
                  value={form.expectedCloseDate}
                  onChange={(e) => set("expectedCloseDate", e.target.value)}
                  aria-invalid={!!errors.expectedCloseDate || undefined}
                  className={`${field} ${errors.expectedCloseDate ? bad : ""}`}
                />
              </Field>
              <Field id="kind" label={t("deal.type")}>
                <Select
                  id="kind"
                  value={form.kind}
                  onChange={(v) => set("kind", v as DealKind)}
                  options={DEAL_KINDS.map((k) => ({ value: k, label: t(`deal.type${k[0].toUpperCase()}${k.slice(1)}` as "deal.typeNew") }))}
                />
              </Field>
              {form.kind !== "new" && (
                <Field id="parent" label={t("deal.parent")} error={errors.parentDealId}>
                  <Select
                    id="parent"
                    value={form.parentDealId}
                    onChange={(v) => set("parentDealId", v)}
                    invalid={!!errors.parentDealId}
                    placeholder={t("common.choose")}
                    options={parents.map((p) => ({ value: p.id, label: p.name }))}
                  />
                </Field>
              )}
            </div>
          </Section>

          {/* ---- Produk ---------------------------------------------------------------------- */}
          <Section
            title={t("deal.products")}
            action={
              <button
                type="button"
                onClick={addLine}
                className="flex h-11 items-center gap-1.5 rounded-full border border-line bg-white px-4 font-medium text-ink hover:bg-paper desk:h-9"
              >
                <span aria-hidden="true">+</span> {t("deal.addProduct")}
              </button>
            }
          >
            {errors.lines && (
              <p role="alert" className="font-semibold text-ink">
                {errors.lines}
              </p>
            )}
            {rowsShown.length === 0 ? (
              <Field id="est" label={t("deal.estValue")} hint={t("deal.estValueHint")}>
                <input
                  id="est"
                  inputMode="numeric"
                  value={money(form.estAmount)}
                  onChange={(e) => set("estAmount", digits(e.target.value))}
                  className={`${field} tabular`}
                />
              </Field>
            ) : (
              <>
                <div className="hidden grid-cols-[1fr_72px_150px_160px] gap-2 text-sm text-slate md:grid">
                  <span>{t("deal.products")}</span>
                  <span>{t("deal.unit")}</span>
                  <span>{t("deal.pricePerUnit")}</span>
                  <span className="pr-12 text-right">{t("deal.subtotal")}</span>
                </div>
                <ul className="flex flex-col gap-3">
                  {rowsShown.map((l) => {
                    const note = lineNote(l);
                    return (
                      <li key={l.key} className="grid grid-cols-[1fr_72px] gap-2 md:grid-cols-[1fr_72px_150px_160px]">
                        <Select
                          label={t("deal.lineProduct")}
                          searchLabel={t("common.search")}
                          value={l.productId}
                          onChange={(v) => pickProduct(l.key, v)}
                          placeholder={t("common.choose")}
                          options={products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }))}
                        />
                        <input
                          aria-label={t("deal.unit")}
                          inputMode="numeric"
                          value={l.qty}
                          onChange={(e) => setLine(l.key, { qty: digits(e.target.value) })}
                          className={`${field} tabular`}
                        />
                        <input
                          aria-label={t("deal.pricePerUnit")}
                          inputMode="numeric"
                          value={money(l.unitPrice)}
                          onChange={(e) => setLine(l.key, { unitPrice: digits(e.target.value) })}
                          className={`${field} tabular`}
                        />
                        <div className="flex items-center justify-between gap-2 md:justify-end">
                          <span className="tabular font-semibold text-ink">{rupiah(l.qtyN * l.priceN)}</span>
                          <button
                            type="button"
                            aria-label={t("deal.removeProduct")}
                            onClick={() => removeLine(l.key)}
                            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full text-slate hover:bg-paper hover:text-ink"
                          >
                            <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                              <path d="M3 3l12 12M15 3L3 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                        {note && (
                          <p className={`col-span-full text-sm ${note.late ? "text-late" : "text-slate"}`}>{note.text}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="flex items-baseline justify-between gap-3 rounded-sm bg-paper px-4 py-3">
                  <span className="text-slate">
                    {t("deal.total")} <span className="tabular text-xl font-semibold text-ink">{rupiah(previewTotal)}</span>
                  </span>
                  <span className="text-slate">{t("common.screenUnits", { n: previewUnits })}</span>
                </div>
              </>
            )}
            {isProject && (
              <p className="rounded-sm bg-paper px-4 py-3 text-ink" role="note">
                {t("deal.project")}
              </p>
            )}
          </Section>

          {/* ---- Next step ------------------------------------------------------------------- */}
          {!closed && (
            <Section title={t("deal.nextStep")}>
              <Field id="nextStep" label={t("deal.nextStepWhat")} error={errors.nextStep}>
                <input
                  id="nextStep"
                  value={form.nextStep}
                  onChange={(e) => set("nextStep", e.target.value)}
                  aria-invalid={!!errors.nextStep || undefined}
                  className={`${field} ${errors.nextStep ? bad : ""}`}
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field id="nextStepDate" label={t("deal.nextStepDate")} error={errors.nextStepDate}>
                  <input
                    id="nextStepDate"
                    type="date"
                    value={form.nextStepDate}
                    onChange={(e) => set("nextStepDate", e.target.value)}
                    aria-invalid={!!errors.nextStepDate || undefined}
                    className={`${field} ${errors.nextStepDate ? bad : ""}`}
                  />
                </Field>
                <Field id="demoDate" label={t("deal.demoDate")} hint={t("deal.demoHint")}>
                  <input
                    id="demoDate"
                    type="date"
                    value={form.demoDate}
                    onChange={(e) => set("demoDate", e.target.value)}
                    className={field}
                  />
                </Field>
              </div>
            </Section>
          )}

          {/* ---- Done deal / Lost ------------------------------------------------------------ */}
          {form.stageKey === "done" && (
            <Section title={t("stage.done")}>
              <Field id="paid" label={t("deal.paidDate")}>
                <input id="paid" type="date" value={form.paidDate} onChange={(e) => set("paidDate", e.target.value)} className={field} />
              </Field>
            </Section>
          )}
          {form.stageKey === "lost" && (
            <Section title={t("lostReason.title")}>
              <Field id="lostReason" label={t("lostReason.title")} error={errors.lostReason}>
                <Select
                  id="lostReason"
                  value={form.lostReason}
                  onChange={(v) => set("lostReason", v)}
                  invalid={!!errors.lostReason}
                  placeholder={t("common.choose")}
                  options={LOST_REASONS.map((r) => ({ value: r, label: t(`lostReason.${r}`) }))}
                />
              </Field>
              <Field id="competitor" label={t("lostReason.competitor")} hint={t("deal.competitorHint")}>
                <Suggest
                  id="competitor"
                  value={form.competitor}
                  onChange={(v) => set("competitor", v)}
                  suggestions={COMPETITORS}
                  className={field}
                />
              </Field>
              <Field id="lostNote" label={t("lostReason.note")}>
                <textarea
                  id="lostNote"
                  rows={3}
                  value={form.lostNote}
                  onChange={(e) => set("lostNote", e.target.value)}
                  className="w-full rounded-sm border border-input bg-white px-3 py-3 text-base text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                />
              </Field>
            </Section>
          )}

          {/* ---- Catatan and Riwayat --------------------------------------------------------- */}
          {!readOnly && (
            <Section title={t("deal.notes")}>
              <Field id="note" label={t("deal.noteAdd")}>
                <textarea
                  id="note"
                  rows={3}
                  value={form.note}
                  onChange={(e) => set("note", e.target.value)}
                  className="w-full rounded-sm border border-input bg-white px-3 py-3 text-base text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                />
              </Field>
            </Section>
          )}
        </fieldset>

        {!isNew && (
          <Section title={t("deal.history")}>
            <History items={deal.history} />
          </Section>
        )}

        {!readOnly && (
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-white/95 px-6 py-3 backdrop-blur">
            {errors.form && (
              <p role="alert" className="mr-auto font-semibold text-ink">
                {errors.form}
              </p>
            )}
            {status && !errors.form && (
              <p role="status" className="mr-auto text-slate">
                {status}
              </p>
            )}
            <button
              type="button"
              onClick={frame.close}
              className="h-11 rounded-full border border-line bg-white px-5 text-base text-ink hover:bg-paper desk:h-9"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="h-11 rounded-full bg-ink px-6 text-base font-semibold text-white hover:bg-ink/85 desk:h-9 disabled:opacity-60"
            >
              {t("common.save")}
            </button>
          </div>
        )}
      </form>
    </>
  );
}

/** wa.me wants the number with the country code and no signs: 0812… → 62812… */
function waNumber(phone: string): string {
  const d = digits(phone);
  return d.startsWith("0") ? `62${d.slice(1)}` : d;
}

/** Asal lead: the source group, channel, ad or campaign and when the lead came in. Read-only. */
function LeadSource({ deal }: { deal: DealDetail }) {
  const tr: LeadTrace | null = deal.leadTrace;
  if (!tr) {
    return (
      <p className="py-2 text-slate">
        {deal.sourceChannel ? t(`sourceChannel.${deal.sourceChannel as "meta_ctwa"}`) : t("deal.noLead")}
      </p>
    );
  }
  const group = t(`sourceGroup.${tr.group as "meta"}`);
  const channel = t(`sourceChannel.${tr.channel as "meta_ctwa"}`);
  const code = tr.adCode ?? (tr.clickCode ? `#${tr.clickCode}` : null);
  const detail = tr.adName
    ? t("prospek.traceAd", { name: tr.adName })
    : tr.utmCampaign
      ? t("prospek.traceCampaign", { name: tr.utmCampaign })
      : tr.landingUrl
        ? t("prospek.tracePage", { page: tr.landingUrl.replace(/^https?:\/\/(www\.)?/, "") })
        : null;
  return (
    <div className="min-w-0 rounded-sm bg-paper px-3 py-2.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-ink">{group}</span>
        {channel !== group && <span className="text-slate">{channel}</span>}
        {code && <span className="rounded-md border border-line bg-white px-1.5 py-0.5 font-mono text-xs text-slate">{code}</span>}
      </p>
      {detail && <p className="mt-0.5 break-words text-sm text-slate">{detail}</p>}
      <p className="tabular mt-0.5 text-sm text-faint">{t("deal.leadReceived", { date: dayMonthTime(tr.receivedAt) })}</p>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-6 py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-ink">{title}</h2>
        {action}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({
  id,
  label: text,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={label}>
        {text}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-sm font-semibold text-ink">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-sm text-slate">{hint}</p>
      ) : null}
    </div>
  );
}

function Lock() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="2.5" y="6" width="9" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function History({ items }: { items: HistoryItem[] }) {
  if (items.length === 0) return <p className="text-slate">{t("deal.historyEmpty")}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((h) => (
        <li key={h.id} className="text-ink">
          <p>
            {h.kind === "stage" && h.stageKey
              ? t("deal.historyMoved", { stage: t(`stage.${h.stageKey}`), name: h.by ?? "" })
              : h.kind === "note"
                ? h.text
                : t("deal.historyCreated")}
          </p>
          <p className="text-sm text-slate">
            {h.kind === "note" && h.by ? `${h.by} · ` : ""}
            {relTime(h.at)}
            {h.stageKey && ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

export { dayMonth, STAGE_KEYS };
