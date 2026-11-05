import { t } from "@/lib/copy";
import { getCatalog, getRules, getStages, getTeam, PRODUCT_LINES, TEAM_ROLES } from "@/lib/settings";
import {
  addMemberAction, saveCatalogAction, saveDefinitionsAction, saveProbabilitiesAction, saveRulesAction, saveTeamAction,
} from "./actions";
import { inputCls, labelCls } from "./formStyles";
import { SectionForm } from "./SectionForm";

const digits = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const fmt = (v: string | number | null) => (v === null || v === "" ? "" : digits.format(Number(v)));
const th = "px-3 py-2 text-left text-sm font-semibold text-slate";
const checkbox = "h-5 w-5 accent-ink";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-sm text-slate">{hint}</p>}
    </div>
  );
}

/** Everything only admin and the CEO may change. */
export async function OwnerSections() {
  const [rules, stages, team, catalog] = await Promise.all([getRules(), getStages(), getTeam(), getCatalog()]);
  const open = stages.filter((s) => !s.isWon && !s.isLost);

  return (
    <>
      <SectionForm id="aturan" title={t("pengaturan.rules")} action={saveRulesAction}>
        <div className="grid gap-4 md:grid-cols-3">
          <Field id="md" label={t("pengaturan.maxDiscount")} hint={t("pengaturan.maxDiscountHint")}>
            <input id="md" name="maxDiscountPct" inputMode="decimal" defaultValue={String(rules.maxDiscountPct).replace(".", ",")} className={`${inputCls} tabular`} />
          </Field>
          <Field id="fd" label={t("pengaturan.followupDays")}>
            <input id="fd" name="followupDays" inputMode="numeric" defaultValue={rules.followupDays} className={`${inputCls} tabular`} />
          </Field>
          <Field id="pu" label={t("pengaturan.projectUnits")}>
            <input id="pu" name="projectMinUnits" inputMode="numeric" defaultValue={rules.projectMinUnits} className={`${inputCls} tabular`} />
          </Field>
          <Field id="pa" label={t("pengaturan.projectAmount")}>
            <input id="pa" name="projectMinAmount" inputMode="numeric" defaultValue={fmt(rules.projectMinAmount)} className={`${inputCls} tabular`} />
          </Field>
          <Field id="hv" label={t("pengaturan.highValue")}>
            <input id="hv" name="highValueAmount" inputMode="numeric" defaultValue={fmt(rules.highValueAmount)} className={`${inputCls} tabular`} />
          </Field>
        </div>
        <h3 className="mb-2 mt-6 font-semibold text-ink">{t("pengaturan.staleDays")}</h3>
        <div className="grid gap-4 md:grid-cols-4">
          {open.map((s) => (
            <Field key={s.id} id={`st-${s.id}`} label={s.name}>
              <input id={`st-${s.id}`} name={`stale:${s.id}`} inputMode="numeric" defaultValue={s.staleDays} className={`${inputCls} tabular`} />
            </Field>
          ))}
        </div>
      </SectionForm>

      <SectionForm id="peluang" title={t("pengaturan.probabilities")} hint={t("pengaturan.probabilitiesHint")} action={saveProbabilitiesAction}>
        <div className="grid gap-4 md:grid-cols-4">
          {open.map((s) => (
            <Field key={s.id} id={`pr-${s.id}`} label={s.name}>
              <input id={`pr-${s.id}`} name={`prob:${s.id}`} inputMode="numeric" defaultValue={s.probabilityPct} className={`${inputCls} tabular`} />
            </Field>
          ))}
        </div>
      </SectionForm>

      <SectionForm id="definisi" title={t("pengaturan.stageDefinitions")} action={saveDefinitionsAction}>
        <div className="flex flex-col gap-4">
          {stages.map((s) => (
            <Field key={s.id} id={`df-${s.id}`} label={s.name}>
              <textarea id={`df-${s.id}`} name={`def:${s.id}`} rows={2} maxLength={400} defaultValue={s.definition} className="w-full rounded-sm border border-input bg-white px-3 py-2 text-base text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10" />
            </Field>
          ))}
        </div>
      </SectionForm>

      <SectionForm id="tim" title={t("pengaturan.team")} hint={t("pengaturan.inactiveHint")} action={saveTeamAction}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-base">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>{t("pengaturan.colName")}</th>
                <th className={th}>{t("pengaturan.colRole")}</th>
                <th className={th}>{t("pengaturan.active")}</th>
                <th className={th}>{t("pengaturan.colAccepting")}</th>
                <th className={th}>{t("pengaturan.colLines")}</th>
                <th className={th}>{t("pengaturan.colWa")}</th>
                <th className={th}>{t("pengaturan.colWaLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-ink">{m.fullName}</p>
                    <p className="text-sm text-slate">{m.email}</p>
                  </td>
                  <td className="px-3 py-2">
                    <select name={`role:${m.id}`} defaultValue={m.role} aria-label={`${t("pengaturan.colRole")} ${m.fullName}`} className={inputCls}>
                      {TEAM_ROLES.map((r) => (
                        <option key={r} value={r}>{t(`pengaturan.role.${r}`)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3"><input type="checkbox" name={`active:${m.id}`} defaultChecked={m.isActive} aria-label={`${t("pengaturan.active")} ${m.fullName}`} className={checkbox} /></td>
                  <td className="px-3 py-3"><input type="checkbox" name={`accepting:${m.id}`} defaultChecked={m.acceptingLeads} aria-label={`${t("pengaturan.colAccepting")} ${m.fullName}`} className={checkbox} /></td>
                  <td className="px-3 py-2">
                    <div className="flex gap-3">
                      {PRODUCT_LINES.map((l) => (
                        <label key={l} className="flex min-h-11 items-center gap-1.5">
                          <input type="checkbox" name={`lines:${m.id}`} value={l} defaultChecked={m.productLines.includes(l)} className={checkbox} />
                          {t(`productLine.${l}`)}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2"><input name={`wa:${m.id}`} defaultValue={m.waPhone} inputMode="tel" aria-label={`${t("pengaturan.colWa")} ${m.fullName}`} className={`${inputCls} tabular`} /></td>
                  <td className="px-3 py-2"><input name={`walabel:${m.id}`} defaultValue={m.waLabel} aria-label={`${t("pengaturan.colWaLabel")} ${m.fullName}`} className={inputCls} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionForm>

      <SectionForm id="tambah" title={t("pengaturan.addMember")} action={addMemberAction} saveLabel={t("pengaturan.addMember")}>
        <div className="grid gap-4 md:grid-cols-3">
          <Field id="am-name" label={t("pengaturan.colName")}><input id="am-name" name="name" className={inputCls} /></Field>
          <Field id="am-email" label={t("pengaturan.colEmail")}><input id="am-email" name="email" type="email" autoComplete="off" className={inputCls} /></Field>
          <Field id="am-role" label={t("pengaturan.colRole")}>
            <select id="am-role" name="role" defaultValue="sales_rep" className={inputCls}>
              {TEAM_ROLES.map((r) => (
                <option key={r} value={r}>{t(`pengaturan.role.${r}`)}</option>
              ))}
            </select>
          </Field>
        </div>
      </SectionForm>

      <SectionForm id="katalog" title={t("pengaturan.catalog")} hint={t("pengaturan.msrp")} action={saveCatalogAction}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-base">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>{t("pengaturan.colProduct")}</th>
                <th className={th}>{t("pengaturan.msrp")}</th>
                <th className={th}>{t("pengaturan.maxDiscountItem")}</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <span className="mr-2 rounded-sm bg-paper px-2 py-0.5 font-mono text-sm text-slate">{p.sku}</span>
                    {p.name}
                  </td>
                  <td className="px-3 py-2"><input name={`price:${p.id}`} inputMode="numeric" defaultValue={fmt(p.listPrice)} aria-label={`${t("pengaturan.msrp")} ${p.sku}`} className={`${inputCls} tabular text-right`} /></td>
                  <td className="px-3 py-2">
                    <input name={`disc:${p.id}`} inputMode="decimal" defaultValue={p.maxDiscountPct ? p.maxDiscountPct.replace(".", ",").replace(/,00$/, "") : ""} placeholder={t("pengaturan.defaultLimit")} aria-label={`${t("pengaturan.maxDiscountItem")} ${p.sku}`} className={`${inputCls} tabular text-right`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionForm>

      <section aria-labelledby="data-h" className="rounded-lg bg-white p-5 shadow-card">
        <h2 id="data-h" className="text-base font-semibold text-ink">{t("pengaturan.data")}</h2>
        <p className="mt-1 text-sm text-slate">{t("pengaturan.exportHint")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href="/pengaturan/ekspor/deals" download className="flex h-11 items-center rounded-full border border-line bg-white px-4 font-medium text-ink hover:bg-paper md:h-9">{t("pengaturan.exportDeals")}</a>
          <a href="/pengaturan/ekspor/kontak" download className="flex h-11 items-center rounded-full border border-line bg-white px-4 font-medium text-ink hover:bg-paper md:h-9">{t("pengaturan.exportContacts")}</a>
        </div>
      </section>
    </>
  );
}

