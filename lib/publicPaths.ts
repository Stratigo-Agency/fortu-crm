// Paths anyone may open without signing in. Static files and brand assets are
// excluded by the proxy matcher instead.
const PUBLIC = [/^\/masuk(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/v1(\/|$)/, /^\/go(\/|$)/];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC.some((re) => re.test(pathname));
}

const BASE = "http://next.invalid";

/**
 * Where to go after signing in: only a same-site path, never another host.
 * Resolved the way a browser would (it drops tabs and newlines, so "/\t/x.com"
 * means "//x.com"), and kept only if it stays on this origin.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next?.startsWith("/")) return "/";
  try {
    const url = new URL(next, BASE);
    return url.origin === BASE ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}
