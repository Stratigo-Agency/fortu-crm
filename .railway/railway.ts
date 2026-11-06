import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "asia-southeast1-eqsg3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 50000 });
  const fortuCrm = service("fortu-crm", {
    deploy: { preDeployCommand: ["npm run db:migrate"], startCommand: "npm start", healthcheckPath: "/api/health", healthcheckTimeout: 120 },
    build: { buildCommand: "npm run build" },
    source: github("Stratigo-Agency/fortu-crm", { checkSuites: false }),
    replicas: { "asia-southeast1-eqsg3a": 1 },
    env: { AUTH_SECRET: preserve(), AUTH_TRUST_HOST: preserve(), AUTH_URL: preserve(), DATABASE_URL: preserve(), HOSTNAME: preserve(), WEBFORM_HMAC_SECRET: preserve() },
  });

  const cronSweeper = service("cron-sweeper", {
    source: github("Stratigo-Agency/fortu-crm", { checkSuites: false }),
    build: { buildCommand: "npm run build" },
    deploy: { startCommand: "node jobs/sweeper.js", cronSchedule: "0 1-13 * * *", preDeployCommand: [], restartPolicyType: "NEVER" },
    env: {
      DATABASE_URL: "${{Postgres.DATABASE_URL}}",
      AUTH_URL: "https://fortu-crm-production.up.railway.app",
    },
  });
  const cronRetryInbound = service("cron-retry-inbound", {
    source: github("Stratigo-Agency/fortu-crm", { checkSuites: false }),
    build: { buildCommand: "npm run build" },
    deploy: { startCommand: "node jobs/retry-inbound.js", cronSchedule: "*/5 * * * *", preDeployCommand: [], restartPolicyType: "NEVER" },
    env: { DATABASE_URL: "${{Postgres.DATABASE_URL}}" },
  });

  return project("fortu-crm", {
    resources: [fortuCrm, cronSweeper, cronRetryInbound, Postgres, postgresVolume],
  });
});
