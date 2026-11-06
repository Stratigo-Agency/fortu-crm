import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { digits, setupLine } from "./whatsappHelpers";

describe("v_wa_response_times", () => {
  it("median first response, shares within 15 min and 1 h, and chats unanswered over 2 h, per rep", async () => {
    const { rep, lineId } = await setupLine();
    const mk = async (agoMin: number, answeredAfterMin: number | null) => {
      const [c] = await sql`INSERT INTO contacts (phone_e164) VALUES (${`+62812${digits(8)}`}) RETURNING id`;
      await sql`
        INSERT INTO leads (contact_id, owner_user_id, wa_line_id, source_channel, capture_method, received_at, first_response_at)
        VALUES (${c.id}, ${rep.id}, ${lineId}, 'whatsapp_direct', 'cloud_api_webhook', now() - make_interval(mins => ${agoMin}),
                CASE WHEN ${answeredAfterMin}::int IS NULL THEN NULL
                     ELSE now() - make_interval(mins => ${agoMin}) + make_interval(mins => ${answeredAfterMin}::int) END)`;
    };
    await mk(600, 10);
    await mk(500, 30);
    await mk(400, 90);
    await mk(300, null); // unanswered for 5 h
    await mk(5, null); // too fresh to count against 15 min
    const [row] = await sql`SELECT * FROM v_wa_response_times WHERE owner_user_id = ${rep.id}`;
    expect(row).toMatchObject({ leads: 5, answered: 3, pct_within_15m: 25, pct_within_1h: 50, unanswered_over_2h: 1 });
    expect(Number(row.median_first_response_min)).toBe(30);
  });
});
