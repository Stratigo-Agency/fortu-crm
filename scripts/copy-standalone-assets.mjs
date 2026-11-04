// The standalone server only serves public/ and .next/static when they sit
// next to it, so copy them in after `next build`.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".next/standalone");

if (!existsSync(out)) {
  console.error(".next/standalone is missing: is output: 'standalone' set in next.config.ts?");
  process.exit(1);
}
cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
cpSync(path.join(root, ".next/static"), path.join(out, ".next/static"), { recursive: true });
