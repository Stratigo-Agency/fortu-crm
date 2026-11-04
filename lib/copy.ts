import messages from "@/messages/id.json";

type Messages = typeof messages;

/** Every dotted path in messages/id.json that ends at a string, e.g. "nav.prospek". */
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;

type Vars = Record<string, string | number>;

function lookup(key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object" || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * UI text from messages/id.json, with {name} placeholders filled from vars.
 * A missing key throws outside production (so it shows up in dev and tests)
 * and falls back to the key itself in production.
 */
export function t(key: MessageKey, vars?: Vars): string {
  const text = lookup(key);
  if (text === undefined) {
    if (process.env.NODE_ENV !== "production") throw new Error(`Missing copy key: ${key}`);
    return key;
  }
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
