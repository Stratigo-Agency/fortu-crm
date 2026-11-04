import { defineConfig } from "vitest/config";

// Same env as the npm db:* scripts. Values already in the environment win.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local (CI sets the variables itself)
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    globalSetup: ["tests/global-setup.ts"],
    // All DB tests share one fortu_test database.
    fileParallelism: false,
  },
});
