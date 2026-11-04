import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPublicPath } from "@/lib/publicPaths";

// Every page needs a signed-in user, except the public paths in lib/publicPaths.ts.
export const proxy = auth((req) => {
  if (req.auth || isPublicPath(req.nextUrl.pathname)) return;
  const url = new URL("/masuk", req.nextUrl);
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|icon\\.png|favicon\\.ico).*)"],
};
