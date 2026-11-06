import { DEFAULT_GRAPH_VERSION } from "@/lib/meta/insights";

// Small Graph API client for the WhatsApp onboarding calls (lib/whatsapp/onboard.ts). Server only.
// Tokens go in the Authorization header or the query of a server-to-server call; they are never logged.

export const graphVersion = () => process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;

export class GraphError extends Error {
  constructor(readonly step: string, readonly status: number, readonly code: number | null) {
    super(`Meta ${step} failed (HTTP ${status}${code === null ? "" : `, code ${code}`})`);
    this.name = "GraphError";
  }
}

type Options = {
  method?: "GET" | "POST";
  token?: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
};

/** One Graph call. `step` names it in errors (no secrets, no response text). */
export async function graph<T = Record<string, unknown>>(step: string, path: string, o: Options = {}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.body) headers["content-type"] = "application/json";
  const res = await fetch(url, {
    method: o.method ?? "GET",
    headers,
    body: o.body ? JSON.stringify(o.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.error) {
    const err = json.error as { code?: unknown } | undefined;
    throw new GraphError(step, res.status, typeof err?.code === "number" ? err.code : null);
  }
  return json as T;
}
