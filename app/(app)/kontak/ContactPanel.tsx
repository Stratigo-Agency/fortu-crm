import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authz";
import type { ContactDetail } from "@/lib/contactTypes";
import { getContact } from "@/lib/contacts";
import { t } from "@/lib/copy";
import { PanelFrame } from "../deal/PanelFrame";
import { ContactForm } from "./ContactForm";

/** The contact panel over the list: ?contact=<id>, or ?contact=new for a blank one. */
export async function ContactPanel({ id, closeHref }: { id: string; closeHref: string }) {
  const user = await requireUser();
  let contact: ContactDetail | null;
  if (id === "new") {
    contact = {
      id: null, name: "", jobTitle: "", email: "", phone: "", companyName: "", ownerName: user.full_name,
      canEdit: true, lastChatAt: null, needsFollowup: false, timeline: [], deals: [],
    };
  } else {
    contact = await getContact(id, user.id);
  }
  if (!contact) notFound();
  return (
    <PanelFrame variant="query" closeHref={closeHref} label={t("kontak.title")}>
      <ContactForm key={contact.id ?? "new"} contact={contact} />
    </PanelFrame>
  );
}
