import { createHmac } from "node:crypto";

// Read-only client for the Accurate Online API (API Token mode).
// It exposes GET helpers only: there is no way to send a POST, PUT or DELETE through it, and the path
// must be a read endpoint (list.do, detail.do, list-stock.do, get-stock.do). The CRM never writes to Accurate.
// Docs: see docs/deploy.md ("cron-accurate") for the URLs this follows.

export class AccurateApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AccurateApiError";
  }
}

export type AccurateConfig = {
  token: string;
  signatureSecret: string;
  /** e.g. https://zeus.accurate.id ; empty = ask account.accurate.id (api-token.do) */
  host?: string;
  /** Session / database id sent as X-Session-ID; empty = taken from api-token.do */
  databaseId?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  maxRetries?: number;
};

export const ACCOUNT_HOST = "https://account.accurate.id";

/** Exactly the endpoints the sync uses; nothing else can be called. */
export const ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "/api/item/list.do",
  "/api/item/list-stock.do",
  "/api/item/get-stock.do",
  "/api/warehouse/list.do",
  "/api/purchase-order/list.do",
  "/api/purchase-order/detail.do",
  "/api/sales-invoice/list.do",
  "/api/sales-invoice/detail.do",
]);
/** Query parameter names the sync uses. Anything else is refused. */
export const ALLOWED_PARAMS: ReadonlySet<string> = new Set([
  "id", "no", "fields", "warehouseName", "sp.page", "sp.pageSize", "filter.transDate.op", "filter.transDate.val",
]);

/** The database host must be https://<name>.accurate.id (no port, credentials or path). Returns the origin. */
export function assertAccurateHost(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AccurateApiError("Accurate host is not a valid URL");
  }
  const okPath = u.pathname === "/" || u.pathname === "";
  if (u.protocol !== "https:" || !u.hostname.endsWith(".accurate.id") || u.port || u.username || u.password || !okPath || u.search || u.hash)
    throw new AccurateApiError("Accurate host must be https://<name>.accurate.id");
  return u.origin;
}

/** Reads the config from env; throws a plain message naming the missing variables. */
export function configFromEnv(env: Record<string, string | undefined> = process.env): AccurateConfig {
  const token = env.ACCURATE_API_TOKEN;
  const signatureSecret = env.ACCURATE_SIGNATURE_SECRET;
  if (!token || !signatureSecret) throw new AccurateApiError("ACCURATE_API_TOKEN and ACCURATE_SIGNATURE_SECRET must be set");
  return { token, signatureSecret, host: env.ACCURATE_HOST || undefined, databaseId: env.ACCURATE_DATABASE_ID || undefined };
}

/** Accurate wants the time as dd/MM/yyyy HH:mm:ss (Jakarta). */
export function apiTimestamp(d: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

/** Base64 HMAC-SHA256 of the timestamp with the signature secret. */
export function sign(timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(timestamp).digest("base64");
}

type Params = Record<string, string | number | boolean | undefined | string[]>;
export type Page<T> = { s?: boolean; d?: T[]; sp?: { page?: number; pageCount?: number; rowCount?: number } };

function query(params: Params): string {
  for (const k of Object.keys(params)) if (!ALLOWED_PARAMS.has(k)) throw new AccurateApiError(`Refusing parameter ${k}`);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x, i) => q.append(v.length === 1 ? k : `${k}[${i}]`, x));
    else q.append(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function createAccurateClient(cfg: AccurateConfig) {
  const doFetch = cfg.fetch ?? fetch;
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = cfg.now ?? (() => new Date());
  const maxRetries = cfg.maxRetries ?? 4;
  let host = cfg.host ? assertAccurateHost(cfg.host) : undefined;
  let session = cfg.databaseId;
  let resolved = false;

  async function request(base: string, path: string, params: Params, withSession: boolean): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const ts = apiTimestamp(now());
      const headers: Record<string, string> = {
        Authorization: `Bearer ${cfg.token}`,
        "X-Api-Timestamp": ts,
        "X-Api-Signature": sign(ts, cfg.signatureSecret),
        Accept: "application/json",
      };
      if (withSession && session) headers["X-Session-ID"] = session;
      // method is fixed: this client cannot write.
      // redirect: "error" so the token and signature never travel to another host.
      let res: Response;
      try {
        res = await doFetch(`${base}${path}${query(params)}`, { method: "GET", headers, redirect: "error" });
      } catch (e) {
        throw new AccurateApiError(`Accurate request failed${e instanceof Error && e.message ? `: ${e.message}` : ""}`);
      }
      if (res.status >= 300 && res.status < 400) throw new AccurateApiError(`Accurate answered with a redirect (${res.status}); refusing to follow it`, res.status);
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
        continue;
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new AccurateApiError(`Accurate answered ${res.status} without JSON`, res.status);
      }
      const b = body as { s?: boolean; d?: unknown };
      if (!res.ok || b.s === false) {
        const detail = Array.isArray(b.d) ? b.d.join("; ") : typeof b.d === "string" ? b.d : "";
        throw new AccurateApiError(`Accurate error ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
      }
      return body;
    }
  }

  async function resolve() {
    if (resolved) return;
    resolved = true;
    if (host && session) return;
    const body = (await request(ACCOUNT_HOST, "/api/api-token.do", {}, false)) as { d?: { database?: { host?: string; id?: number | string } } };
    const db = body.d?.database;
    if (!host && db?.host) host = assertAccurateHost(db.host);
    session ??= db?.id !== undefined ? String(db.id) : undefined;
    if (!host) throw new AccurateApiError("Accurate did not return a host; set ACCURATE_HOST");
  }

  /** One GET against the database host, e.g. get("/api/item/list.do", { "sp.page": 1 }). */
  async function get<T = unknown>(path: string, params: Params = {}): Promise<T> {
    if (!ALLOWED_PATHS.has(path)) throw new AccurateApiError(`Refusing ${path}: only the read endpoints the sync uses are allowed`);
    query(params); // validates the keys before anything is sent
    await resolve();
    return (await request(`${host}/accurate`, path, params, true)) as T;
  }

  /**
   * Follows sp.page until pageCount and returns every row. Fails instead of returning a partial list:
   * rows without `sp`, an empty page before the last one, or a total that differs from sp.rowCount.
   */
  async function listAll<T = Record<string, unknown>>(path: string, params: Params = {}, pageSize = 100): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 2000; page++) {
      const r = await get<Page<T>>(path, { ...params, "sp.page": page, "sp.pageSize": pageSize });
      if (!Array.isArray(r.d)) throw new AccurateApiError(`${path}: page ${page} has no row list`);
      if (r.d.length > 0 && !r.sp) throw new AccurateApiError(`${path}: page ${page} has rows but no paging info (sp)`);
      out.push(...r.d);
      const pages = r.sp?.pageCount ?? 1;
      if (page < pages && r.d.length === 0) throw new AccurateApiError(`${path}: page ${page} of ${pages} is empty`);
      if (page >= pages) {
        const total = r.sp?.rowCount;
        if (typeof total === "number" && total !== out.length) throw new AccurateApiError(`${path}: got ${out.length} rows, Accurate says ${total}`);
        return out;
      }
    }
    throw new AccurateApiError(`${path}: too many pages`);
  }

  return { get, listAll };
}

export type AccurateClient = ReturnType<typeof createAccurateClient>;
