import { defineConfig, devices } from "@playwright/test";

/**
 * local: starts the built app against docker-compose services (CI and developers).
 * smoke: runs against a deployed environment (staging after each merge, section 24.7).
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const port = Number(process.env.E2E_PORT ?? 3100);
const workerPort = Number(process.env.E2E_WORKER_PORT ?? 3199);
const appEnv = {
  ...process.env,
  APP_BASE_URL: `http://localhost:${port}`,
  RATE_LIMIT_DISABLED: "1",
  // Answers AI reads from the fixture set by file hash (no Vertex AI in tests).
  EXTRACTOR: "fixture",
  POSTMARK_INBOUND_WEBHOOK_SECRET: process.env.POSTMARK_INBOUND_WEBHOOK_SECRET ?? "e2e-inbound-webhook-secret",
} as Record<string, string>;

export default defineConfig({
  testDir: "./specs",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: "local",
      testMatch: /m\d+-.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${port}` },
    },
    {
      name: "smoke",
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: process.env.SMOKE_BASE_URL },
    },
  ],
  webServer: process.env.SMOKE_BASE_URL
    ? undefined
    : [
        {
          command: "pnpm --filter @verilo/web start",
          url: `http://localhost:${port}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { ...appEnv, PORT: String(port), HOSTNAME: "127.0.0.1" },
        },
        {
          // The worker runs the section 14 jobs (extraction, email intake, checks).
          command: "pnpm --filter @verilo/web worker",
          url: `http://127.0.0.1:${workerPort}`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { ...appEnv, APP_ROLE: "worker", WORKER_HEALTH_PORT: String(workerPort) },
        },
      ],
});
