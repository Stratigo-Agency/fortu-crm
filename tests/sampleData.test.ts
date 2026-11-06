import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { leadFunnelRange } from "@/lib/leadFunnel";
import { listProspects, prospekStats } from "@/lib/prospek";
import { sampleDataConnection, showSampleData } from "@/lib/sampleData";
import { createLead, createUser } from "./fixtures";

// Staging can show the demo rows in the funnel and Prospek figures; production never does by default.
const staging = postgres(process.env.DATABASE_URL_TEST as string, { max: 1, connection: sampleDataConnection({ SHOW_SAMPLE_DATA: "1" }) });
afterAll(() => staging.end());

describe("SHOW_SAMPLE_DATA", () => {
  it("is off unless set to exactly 1", () => {
    expect(showSampleData({})).toBe(false);
    for (const v of ["0", "true", "yes", " 1", ""]) expect(showSampleData({ SHOW_SAMPLE_DATA: v })).toBe(false);
    expect(showSampleData({ SHOW_SAMPLE_DATA: "1" })).toBe(true);
    expect(sampleDataConnection({})).toEqual({});
    expect(sampleDataConnection({ SHOW_SAMPLE_DATA: "1" })).toEqual({ "app.show_sample_data": "on" });
  });

  it("the app's default connection leaves sample rows out of the funnel and Prospek; the staging switch lets them in", async () => {
    expect(process.env.SHOW_SAMPLE_DATA).toBeUndefined();
    const rep = await createUser();
    await createLead(rep.id, { source: "meta_ctwa", receivedAt: "2018-11-12T03:00:00Z" });
    const sample = await createLead(rep.id, { source: "website_form", receivedAt: "2018-11-12T03:00:00Z" });
    await sql`UPDATE leads SET is_sample = true WHERE id = ${sample.id}`;

    // production default
    expect((await sql`SELECT show_sample_data() AS on`)[0].on).toBe(false);
    expect((await leadFunnelRange(rep.id, "2018-11-01", "2018-11-30")).total.leads).toBe(1);
    const list = await listProspects({ viewerId: rep.id, ownerId: rep.id, tab: "semua", q: "", limit: 50, group: null });
    expect(list.rows.map((r) => r.id)).not.toContain(sample.id);
    const before = await prospekStats(rep.id);

    // staging with SHOW_SAMPLE_DATA=1
    const [{ leads }] = await staging<{ leads: number }[]>`
      SELECT leads FROM lead_funnel('2018-11-01', '2018-11-30', ${rep.id}::uuid) WHERE is_total`;
    expect(leads).toBe(2);
    const [stats] = await staging<{ open_count: number }[]>`
      SELECT open_count FROM v_prospek_stats WHERE owner_user_id = ${rep.id} AND NOT is_total AND all_groups`;
    expect(stats.open_count).toBe(before.open_count + 1);
  });
});
