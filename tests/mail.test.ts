import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { buildDigest, sendDigests } from "@/lib/mail";
import { runSweep } from "@/lib/sweeper";
import { addLineItem, createDeal, createUser } from "./fixtures";

// Reminder emails, rendered with nodemailer's JSON transport (no SMTP server needed).

type Stage = "chat" | "quotation" | "negotiation" | "po" | "done";

async function deal(ownerId: string, o: { amount: number; stage: Stage; idleDays?: number }) {
  const d = await createDeal(ownerId);
  await addLineItem(d.id, { qty: 1, unitPrice: o.amount });
  await sql`UPDATE deals SET stage_id = (SELECT id FROM pipeline_stages WHERE key = ${o.stage}), expected_close_date = jakarta_today() + 20,
                   next_step_date = jakarta_today() + 5 WHERE id = ${d.id}`;
  if (o.idleDays) {
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`UPDATE deals SET updated_at = now() - make_interval(days => ${o.idleDays ?? 0}::int) WHERE id = ${d.id}`;
    });
  }
  return d.id;
}

describe("reminder emails", () => {
  const send = async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const sent: { to: string; subject: string; text: string }[] = [];
    const real = transport.sendMail.bind(transport);
    transport.sendMail = (async (m: { to: string; subject: string; text: string }) => {
      sent.push(m);
      return real(m);
    }) as typeof transport.sendMail;
    const result = await sendDigests(transport, "crm@fortu.test");
    return { result, sent };
  };

  it("one short email per person with the link, and nothing again on the next run", async () => {
    const owner = await createUser({ fullName: "Rudy Hartono" });
    const ceo = await createUser({ role: "ceo", fullName: "Pak Jovian" });
    const a = await deal(owner.id, { amount: 150_000_000, stage: "negotiation", idleDays: 8 });
    const b = await deal(owner.id, { amount: 200_000_000, stage: "quotation", idleDays: 9 });
    await deal(owner.id, { amount: 300_000_000, stage: "quotation" }); // new today: the CEO hears about this one
    await sql`UPDATE users SET email = ${`rudy-${owner.id}@fortu.test`} WHERE id = ${owner.id}`;
    await runSweep();

    const { result, sent } = await send();
    const mine = sent.filter((m) => m.to === `rudy-${owner.id}@fortu.test`);
    expect(mine).toHaveLength(1); // one email, both stale deals
    expect(mine[0].subject).toBe("2 deal perlu perhatian");
    expect(mine[0].text).toContain("Halo Rudy,");
    expect(mine[0].text).toContain("Uji deal (Negotiation, Rp150 jt): belum ada gerakan");
    expect(mine[0].text).toMatch(/Buka: https?:\/\/.*\/deal\//);
    expect(result.failed).toBe(0);
    const toCeo = sent.filter((m) => m.to === ceo.email);
    expect(toCeo).toHaveLength(1); // one digest, however many big deals came in
    expect(toCeo[0].text).toContain("Uji deal (Quotation, Rp300 jt): deal bernilai besar");

    // sent once: the second run has nothing for them
    const second = await send();
    expect(second.sent.filter((m) => m.to === `rudy-${owner.id}@fortu.test`)).toHaveLength(0);
    expect(await sql`SELECT 1 FROM notifications WHERE channel = 'email' AND deal_id IN (${a}, ${b})`).not.toHaveLength(0);
  });

  it("a later episode of the same deal is emailed again", async () => {
    const owner = await createUser();
    const id = await deal(owner.id, { amount: 150_000_000, stage: "negotiation", idleDays: 8 });
    await sql`UPDATE users SET email = ${`ep-${owner.id}@fortu.test`} WHERE id = ${owner.id}`;
    await runSweep();
    expect((await send()).sent.filter((m) => m.to === `ep-${owner.id}@fortu.test`)).toHaveLength(1);

    // weeks later the deal goes stale again: the owner is told, and emailed, again
    await sql`UPDATE notifications SET sent_at = sent_at - interval '20 days' WHERE deal_id = ${id}`;
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`UPDATE deals SET updated_at = now() - interval '9 days' WHERE id = ${id}`;
    });
    await runSweep();
    expect((await send()).sent.filter((m) => m.to === `ep-${owner.id}@fortu.test`)).toHaveLength(1);
  });

  it("a failed send is recorded as failed and tried again by the next run", async () => {
    const owner = await createUser();
    const id = await deal(owner.id, { amount: 150_000_000, stage: "negotiation", idleDays: 8 });
    await runSweep();
    const broken = nodemailer.createTransport({ jsonTransport: true });
    broken.sendMail = (async () => {
      throw new Error("smtp down");
    }) as typeof broken.sendMail;
    const first = await sendDigests(broken, "crm@fortu.test");
    expect(first.failed).toBeGreaterThan(0);
    expect(await sql`SELECT 1 FROM notifications WHERE channel = 'email' AND deal_id = ${id} AND user_id = ${owner.id}`).toHaveLength(0);
    const second = await send();
    expect(second.sent.some((m) => m.to === owner.email)).toBe(true);
  });

  it("builds a one-deal subject with the reason", () => {
    const d = buildDigest("Rudy", [{ kind: "stale_deal", payload: { deal: { name: "Hotel Arunika", stage: "PO", amount: 96_000_000, url: "https://crm.test/deal/1" } } }]);
    expect(d.subject).toBe("Hotel Arunika · belum ada gerakan");
    expect(d.text).toContain("Buka: https://crm.test/deal/1");
  });
});
