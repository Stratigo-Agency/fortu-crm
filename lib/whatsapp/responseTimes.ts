import { sql } from "@/lib/db";

// Laporan · Kecepatan balas chat and the Perlu perhatian row, both from v_wa_response_times (migration 017).

export type WaResponseRow = {
  userId: string;
  name: string;
  leads: number;
  answered: number;
  medianMin: string | null;
  pct15: number | null;
  pct60: number | null;
  unanswered2h: number;
};

/** One rep (ownerId) or everyone (null). */
export async function getWaResponseTimes(ownerId: string | null): Promise<WaResponseRow[]> {
  return sql<WaResponseRow[]>`
    SELECT v.owner_user_id AS "userId", u.full_name AS name, v.leads, v.answered,
           v.median_first_response_min::text AS "medianMin", v.pct_within_15m AS pct15, v.pct_within_1h AS pct60,
           v.unanswered_over_2h AS "unanswered2h"
      FROM v_wa_response_times v JOIN users u ON u.id = v.owner_user_id
     WHERE ${ownerId}::uuid IS NULL OR v.owner_user_id = ${ownerId}
     ORDER BY u.full_name`;
}

/** Chats of this user still unanswered after 2 hours. For the owner's own Perlu perhatian only. */
export async function getMyUnansweredChats(userId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT unanswered_over_2h AS n FROM v_wa_response_times WHERE owner_user_id = ${userId}`;
  return row?.n ?? 0;
}
