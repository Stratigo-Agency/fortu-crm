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
const READ_PATH = /^\/?(?:accurate\/)?(?:api\/)?[a-z][a-z-]*\/(?:list|detail|list-stock|get-stock)\.do$/;

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
  let host = cfg.host?.replace(/\/+$/, "");
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
      const res = await doFetch(`${base}${path}${query(params)}`, { method: "GET", headers, redirect: "follow" });
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
    host ??= db?.host?.replace(/\/+$/, "");
    session ??= db?.id !== undefined ? String(db.id) : undefined;
    if (!host) throw new AccurateApiError("Accurate did not return a host; set ACCURATE_HOST");
  }

  /** One GET against the database host, e.g. get("/api/item/list.do", { "sp.page": 1 }). */
  async function get<T = unknown>(path: string, params: Params = {}): Promise<T> {
    if (!READ_PATH.test(path)) throw new AccurateApiError(`Refusing ${path}: only read endpoints are allowed`);
    await resolve();
    const p = path.startsWith("/") ? path : `/${path}`;
    const full = /^\/(?:accurate\/)?api\//.test(p) ? p.replace(/^\/accurate/, "") : `/api${p}`;
    return (await request(`${host}/accurate`, full, params, true)) as T;
  }

  /** Follows sp.page until pageCount; returns every row. */
  async function listAll<T = Record<string, unknown>>(path: string, params: Params = {}, pageSize = 100): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; ; page++) {
      const r = await get<Page<T>>(path, { ...params, "sp.page": page, "sp.pageSize": pageSize });
      out.push(...(r.d ?? []));
      const pages = r.sp?.pageCount ?? 1;
      if (page >= pages || !(r.d?.length)) return out;
    }
  }

  return { get, listAll };
}

export type AccurateClient = ReturnType<typeof createAccurateClient>;
