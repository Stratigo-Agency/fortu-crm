"use server";

import { cookies } from "next/headers";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/authz";
import { resolveSalesFilter, SALES_COOKIE } from "@/lib/salesFilter";

export async function signOutAction() {
  await signOut({ redirectTo: "/masuk" });
}

/** Remembers "Semua sales" or one rep for every list and report. */
export async function setSalesFilter(formData: FormData) {
  await requireUser();
  const id = await resolveSalesFilter(formData.get("sales")?.toString());
  const store = await cookies();
  store.set(SALES_COOKIE, id ?? "all", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
