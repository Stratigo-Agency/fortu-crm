import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authz";
import { getCompany } from "@/lib/companies";
import type { CompanyDetail } from "@/lib/contactTypes";
import { t } from "@/lib/copy";
import { PanelFrame } from "../deal/PanelFrame";
import { CompanyForm } from "./CompanyForm";

/** The company panel over the list: ?company=<id>, or ?company=new. */
export async function CompanyPanel({ id, closeHref }: { id: string; closeHref: string }) {
  const user = await requireUser();
  const company: CompanyDetail | null =
    id === "new"
      ? { id: null, name: "", industry: "", city: "", website: "", ownerName: user.full_name, canEdit: true, contacts: [], deals: [] }
      : await getCompany(id, user.id);
  if (!company) notFound();
  return (
    <PanelFrame variant="query" closeHref={closeHref} label={t("perusahaan.title")}>
      <CompanyForm key={company.id ?? "new"} company={company} />
    </PanelFrame>
  );
}
