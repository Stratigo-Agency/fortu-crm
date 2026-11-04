import messages from "@/messages/id.json";

type Vars = Record<string, string | number>;

/**
 * UI text from messages/id.json by dotted key, with {name} placeholders filled
 * from vars. A missing key returns the key itself. (T03 adds typed keys.)
 */
export function t(key: string, vars?: Vars): string {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object" || !(part in node)) return key;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") return key;
  if (!vars) return node;
  return node.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
