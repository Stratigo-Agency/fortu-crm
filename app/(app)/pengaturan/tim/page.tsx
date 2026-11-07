import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { getTeam, TEAM_ROLES } from "@/lib/settings";
import { Select } from "../../ui/Select";
import { PageHeader, PageSkeleton } from "../../PageHeader";
import { addMemberAction, saveTeamAction } from "../actions";
import { inputCls } from "../formStyles";
import { Field } from "../Field";
import { SectionForm } from "../SectionForm";
import { SettingsNav } from "../SettingsNav";
import { Forbidden, isOwner, sectionNav } from "../sections";

const th = "px-3 py-2 text-left text-sm font-medium text-faint";
const checkbox = "check";

export default function Page() {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Team />
      </Suspense>
    </main>
  );
}

async function Team() {
  const user = await requireUser();
  if (!isOwner(user)) return <Forbidden title={t("pengaturan.nav.tim")} />;
  const team = await getTeam();

  return (
    <>
      <PageHeader title={t("pengaturan.nav.tim")} />
      <div className="flex flex-col gap-4 px-4 py-5 md:px-6">
        <SettingsNav items={sectionNav(user)} />
        <SectionForm id="tim" hint={t("pengaturan.inactiveHint")} action={saveTeamAction}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-base">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>{t("pengaturan.colName")}</th>
                  <th className={th}>{t("pengaturan.colRole")}</th>
                  <th className={th}>{t("pengaturan.active")}</th>
                  <th className={th}>{t("pengaturan.colAccepting")}</th>
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
                      <Select
                        name={`role:${m.id}`}
                        defaultValue={m.role}
                        label={`${t("pengaturan.colRole")} ${m.fullName}`}
                        options={TEAM_ROLES.map((r) => ({ value: r, label: t(`pengaturan.role.${r}`) }))}
                        className="min-w-36"
                      />
                    </td>
                    <td className="px-3 py-3"><input type="checkbox" name={`active:${m.id}`} defaultChecked={m.isActive} aria-label={`${t("pengaturan.active")} ${m.fullName}`} className={checkbox} /></td>
                    <td className="px-3 py-3"><input type="checkbox" name={`accepting:${m.id}`} defaultChecked={m.acceptingLeads} aria-label={`${t("pengaturan.colAccepting")} ${m.fullName}`} className={checkbox} /></td>
                    <td className="px-3 py-2"><input name={`wa:${m.id}`} defaultValue={m.waPhone} inputMode="tel" aria-label={`${t("pengaturan.colWa")} ${m.fullName}`} className={`${inputCls} tabular min-w-44`} /></td>
                    <td className="px-3 py-2"><input name={`walabel:${m.id}`} defaultValue={m.waLabel} aria-label={`${t("pengaturan.colWaLabel")} ${m.fullName}`} className={`${inputCls} min-w-40`} /></td>
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
              <Select
                id="am-role"
                name="role"
                defaultValue="sales_rep"
                options={TEAM_ROLES.map((r) => ({ value: r, label: t(`pengaturan.role.${r}`) }))}
              />
            </Field>
          </div>
        </SectionForm>
      </div>
    </>
  );
}
