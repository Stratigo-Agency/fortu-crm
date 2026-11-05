import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { contactsCsv, dealsCsv } from "@/lib/exportCsv";
import { sql } from "@/lib/db";

const FILES = { deals: dealsCsv, kontak: contactsCsv } as const;

/** GET /pengaturan/ekspor/deals or /kontak: a CSV download for the CEO and admins. */
export async function GET(_request: Request, ctx: { params: Promise<{ what: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  // the role is read again here, not taken from the session cookie
  const [user] = await sql<{ role: string }[]>`SELECT role FROM users WHERE id = ${session.user.id} AND is_active`;
  if (!user || (user.role !== "admin" && user.role !== "ceo")) return new NextResponse("Forbidden", { status: 403 });

  const { what } = await ctx.params;
  if (!Object.hasOwn(FILES, what)) return new NextResponse("Not found", { status: 404 });
  const body = await FILES[what as keyof typeof FILES]();
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="fortu-${what}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
