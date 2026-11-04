// Fails when a component in app/ or components/ has UI text that doesn't come from t():
// JSX text, or a string literal in placeholder / title / aria-label / alt (CLAUDE.md rule 1).
//   node scripts/check-copy.mjs        (also part of npm run lint)
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { isMain, root } from "./lib.mjs";

// Stage names and sales words the team already uses (rule 1), and the brand name.
export const ALLOWED = new Set([
  "Quotation",
  "Negotiation",
  "PO",
  "Done deal",
  "Lost",
  "next step",
  "win rate",
  "run rate",
  "Fortu",
]);

const ATTRIBUTES = new Set(["placeholder", "title", "aria-label", "alt"]);
const DIRS = ["app", "components"];

/** Text a person would read: contains a letter, and isn't an allowed word. */
function isUiText(text) {
  const s = text.replace(/\s+/g, " ").trim();
  return /\p{L}/u.test(s) && !ALLOWED.has(s);
}

/** Problems in one source file, as { line, text }. */
export function checkSource(fileName, source) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems = [];
  const report = (node, text) =>
    problems.push({ line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: text.trim() });

  const literal = (expr) =>
    expr && (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) ? expr.text : null;

  function visit(node) {
    if (ts.isJsxText(node) && isUiText(node.text)) report(node, node.text);
    if (ts.isJsxExpression(node) && ts.isJsxElement(node.parent)) {
      const text = literal(node.expression);
      if (text !== null && isUiText(text)) report(node, text);
    }
    if (ts.isJsxAttribute(node) && ATTRIBUTES.has(node.name.getText(file))) {
      const init = node.initializer;
      const text = init && (ts.isStringLiteral(init) ? init.text : ts.isJsxExpression(init) ? literal(init.expression) : null);
      if (text != null && isUiText(text)) report(node, `${node.name.getText(file)}="${text}"`);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return problems;
}

async function* tsxFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // components/ doesn't exist yet
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* tsxFiles(full);
    else if (e.name.endsWith(".tsx")) yield full;
  }
}

if (isMain(import.meta)) {
  let count = 0;
  for (const dir of DIRS) {
    for await (const file of tsxFiles(path.join(root, dir))) {
      for (const p of checkSource(file, await readFile(file, "utf8"))) {
        console.error(`${path.relative(root, file)}:${p.line}  ${p.text}`);
        count++;
      }
    }
  }
  if (count) {
    console.error(`\n${count} hard-coded UI string(s). Put them in messages/id.json and use t().`);
    process.exit(1);
  }
  console.log("copy check passed");
}
