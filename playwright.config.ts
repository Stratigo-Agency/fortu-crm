import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the real app (next dev, port 3100) against their own database,
// signing in through the real /masuk form. Nothing here exists in a production build.
try {
  process.loadEnvFile(".env.local");
} catch {
  // CI sets the variables itself
}

// E2E_PORT and E2E_DB let a second checkout run its own copy at the same time (the database name must end in _test).
const PORT = Number(process.env.E2E_PORT ?? 3100);
process.env.E2E_BASE = `http://localhost:${PORT}`;
const base = process.env.DATABASE_URL_TEST;
if (!base) throw new Error("DATABASE_URL_TEST is not set (copy .env.example to .env.local)");
const dbUrl = new URL(base);
dbUrl.pathname = `/${process.env.E2E_DB ?? "fortu_e2e_test"}`;
process.env.DATABASE_URL_E2E = dbUrl.href;

export const AUTH_FILE = "e2e/.auth/rep.json";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome", // the Chrome already installed; no browser download
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      testMatch: /.*\.desktop\.spec\.ts/,
      dependencies: ["setup"],
      use: { viewport: { width: 1440, height: 1135 }, storageState: AUTH_FILE },
    },
    {
      name: "phone",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /.*\.desktop\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        storageState: AUTH_FILE,
      },
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/masuk`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      E2E: "1",
      NEXT_DIST_DIR: ".next-e2e",
      DATABASE_URL: dbUrl.href,
      AUTH_URL: `http://localhost:${PORT}`,
      AUTH_TRUST_HOST: "true",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-not-used-elsewhere",
    },
  },
});
