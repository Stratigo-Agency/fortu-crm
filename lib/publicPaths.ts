// Paths anyone may open without signing in. Static files and brand assets are
// excluded by the proxy matcher instead.
const PUBLIC = [/^\/masuk(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/v1(\/|$)/, /^\/go(\/|$)/];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC.some((re) => re.test(pathname));
}

/** Where to go after signing in: only a same-site path, never another host. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
