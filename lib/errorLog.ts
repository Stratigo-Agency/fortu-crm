// What the server writes to the Railway log when a request fails. One JSON line, so a log search or alert can
// match on `"event":"request_error"`. Our own line holds no message (an error message can quote a phone number
// or a name), no query string, no headers, no body. It is not the only thing in the log: Next.js itself still
// prints the original error (with its message) to stderr, so keep error messages generic and never put a
// phone number, name or email into one. The `digest` is the code that the error page
// shows to the person, so a report ("Kode: 123") can be matched to its line.

export type RequestErrorLine = {
  event: "request_error";
  name: string;
  digest: string | null;
  method: string;
  path: string;
  routePath: string | null;
  routeType: string | null;
  at: string;
};

export function requestErrorLine(
  err: unknown,
  request: { path: string; method: string },
  context?: { routePath?: string; routeType?: string },
  now = new Date(),
): RequestErrorLine {
  const e = err as { name?: unknown; digest?: unknown } | null;
  return {
    event: "request_error",
    name: typeof e?.name === "string" ? e.name : "Error",
    digest: typeof e?.digest === "string" ? e.digest : null,
    method: request.method,
    path: request.path.split("?")[0].slice(0, 200),
    routePath: context?.routePath ?? null,
    routeType: context?.routeType ?? null,
    at: now.toISOString(),
  };
}
