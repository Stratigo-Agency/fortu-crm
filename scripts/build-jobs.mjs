// Compiles jobs/*.ts to jobs/*.js (one bundled file each, packages stay external) so Railway cron services
// can run `node jobs/<name>.js`. Part of `npm run build` (postbuild).
import { readdirSync } from "node:fs";
import { build } from "esbuild";

const entries = readdirSync("jobs").filter((f) => f.endsWith(".ts")).map((f) => `jobs/${f}`);
await build({
  entryPoints: entries,
  outdir: "jobs",
  outExtension: { ".js": ".js" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  packages: "external",
  tsconfig: "tsconfig.json",
  logLevel: "info",
});
