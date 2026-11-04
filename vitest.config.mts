import path from "node:path";
import { defineConfig } from "vitest/config";

// Same env as the npm db:* scripts. Values already in the environment win.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local (CI sets the variables itself)
}

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    globalSetup: ["tests/global-setup.ts"],
    // App code (lib/db.ts) talks to the test database, never the dev one.
    env: { DATABASE_URL: process.env.DATABASE_URL_TEST ?? "" },
    // next-auth imports "next/server" without an extension; let Vite resolve it.
    server: { deps: { inline: ["next-auth"] } },
    // All DB tests share one fortu_test database.
    fileParallelism: false,
  },
});
