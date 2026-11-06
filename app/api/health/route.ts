import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { appVersion } from "@/lib/version";

const NO_STORE = { "Cache-Control": "no-store" };
const DB_TIMEOUT_MS = 3000;

/** Railway's healthcheck, also fine for a quick look by hand. Open without signing in; shows no secrets. */
export async function GET() {
  const version = appVersion();
  try {
    await Promise.race([
      sql`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS).unref()),
    ]);
    return NextResponse.json({ status: "ok", db: "ok", version }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ status: "error", db: "down", version }, { status: 503, headers: NO_STORE });
  }
}
