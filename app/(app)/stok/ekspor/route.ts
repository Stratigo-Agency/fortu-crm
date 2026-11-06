import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { stockCsv } from "@/lib/exportCsv";
import { sql } from "@/lib/db";
import { parseStockFilter } from "@/lib/stock";

/** GET /stok/ekspor?lini=IFP&berisiko=1: the table as a CSV, with the screen's filters. Same roles as /stok. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  // the role is read again here, not taken from the session cookie
  const [user] = await sql<{ role: string }[]>`SELECT role FROM users WHERE id = ${session.user.id} AND is_active`;
  if (!user || !["admin", "ceo", "sales_lead"].includes(user.role)) return new NextResponse("Forbidden", { status: 403 });

  const sp = new URL(request.url).searchParams;
  const body = await stockCsv(parseStockFilter({ lini: sp.get("lini") ?? undefined, berisiko: sp.get("berisiko") ?? undefined }));
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="fortu-stok-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
