import nodemailer, { type Transporter } from "nodemailer";
import { t } from "@/lib/copy";
import { rupiahShort } from "@/lib/format";
import { sql } from "@/lib/db";
import { type AlertKind, type AlertPayload } from "@/lib/notificationText";

// Reminder emails (INTEGRATIONS.md · Alerts, channel "in-app + email"): at most one short Bahasa email per
// person per run, only about their own deals (the sweeper only writes reminders for the owner). The email is only sent for notifications that don't have an email row yet; the row is
// written after a successful send, so a failed run is retried by the next one.

export const EMAIL_KINDS = ["stale_deal", "next_step_overdue"] as const satisfies readonly AlertKind[];
type EmailKind = (typeof EMAIL_KINDS)[number];

/** The SMTP transport from SMTP_HOST / SMTP_USER / SMTP_PASS (Hostinger: smtp.hostinger.com, port 465), or null when unset. */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Transporter | null {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  const port = Number(env.SMTP_PORT) || 465;
  return nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: port === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
}

type Item = { id: string; kind: EmailKind; dealId: string; day: string; payload: AlertPayload };
type Person = { userId: string; name: string; email: string; items: Item[] };

export type Digest = { subject: string; text: string };

/** The email for one person: a plain list of deals with their reason and link. */
export function buildDigest(name: string, items: Pick<Item, "kind" | "payload">[]): Digest {
  const reason = (k: EmailKind) => t(`notif.email.reason.${k}`);
  const first = items[0];
  const subject =
    items.length === 1
      ? t("notif.email.subjectOne", { deal: first.payload.deal?.name ?? "", reason: reason(first.kind) })
      : t("notif.email.subjectMany", { n: items.length });
  const lines = items.flatMap((i) => [
    t("notif.email.line", {
      deal: i.payload.deal?.name ?? "",
      stage: i.payload.deal?.stage ?? "",
      amount: i.payload.deal?.amount === undefined ? "" : rupiahShort(i.payload.deal.amount),
      reason: reason(i.kind),
    }),
    t("notif.email.link", { url: i.payload.deal?.url ?? "" }),
  ]);
  const text = [t("notif.email.hello", { name }), "", t("notif.email.intro"), "", ...lines, "", t("notif.email.bye"), ""].join("\n");
  return { subject, text };
}

/** Notifications of the last two days that were not emailed yet, grouped by person. */
async function pending(): Promise<Person[]> {
  const rows = await sql<{ id: string; user_id: string; name: string; email: string; kind: EmailKind; deal_id: string; day: string; payload: AlertPayload }[]>`
    SELECT n.id::text AS id, n.user_id, u.full_name AS name, u.email, n.kind::text AS kind, n.deal_id, n.day::text AS day, n.payload
      FROM notifications n
      JOIN users u ON u.id = n.user_id AND u.is_active AND u.email <> ''
     WHERE n.channel = 'in_app' AND n.kind IN ${sql([...EMAIL_KINDS])} AND n.sent_at > now() - interval '2 days'
       AND NOT EXISTS (SELECT 1 FROM notifications e
                        WHERE e.channel = 'email' AND e.kind = n.kind AND e.deal_id = n.deal_id AND e.user_id = n.user_id
                          AND e.sent_at >= n.sent_at)
     ORDER BY n.user_id, n.sent_at`;
  const people = new Map<string, Person>();
  for (const r of rows) {
    const p = people.get(r.user_id) ?? { userId: r.user_id, name: r.name, email: r.email, items: [] };
    p.items.push({ id: r.id, kind: r.kind, dealId: r.deal_id, day: r.day, payload: r.payload });
    people.set(r.user_id, p);
  }
  return [...people.values()];
}

export type MailResult = { emails: number; items: number; failed: number };

/** Sends one digest per person and records it. A failure for one person doesn't stop the others. */
export async function sendDigests(transport: Transporter, from: string): Promise<MailResult> {
  const result: MailResult = { emails: 0, items: 0, failed: 0 };
  for (const person of await pending()) {
    const { subject, text } = buildDigest(person.name.split(" ")[0], person.items);
    try {
      await transport.sendMail({ from, to: person.email, subject, text });
    } catch (err) {
      result.failed += 1;
      console.error(`sweeper: email to ${person.userId} failed: ${err instanceof Error ? err.message : "unknown error"}`);
      continue;
    }
    try {
      await sql`
        INSERT INTO notifications (user_id, kind, deal_id, channel, payload)
        SELECT n.user_id, n.kind, n.deal_id, 'email', n.payload FROM notifications n WHERE n.id = ANY(${person.items.map((i) => i.id)}::bigint[])
        ON CONFLICT DO NOTHING`;
    } catch (err) {
      // sent, but not recorded: the next run would send it again, so say so loudly and stop here
      result.failed += 1;
      console.error(`sweeper: email to ${person.userId} was sent but not recorded: ${err instanceof Error ? err.message : "unknown error"}`);
      continue;
    }
    result.emails += 1;
    result.items += person.items.length;
  }
  return result;
}
