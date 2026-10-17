import { defineConfig, devices } from "@playwright/test";

/**
 * local: starts the built app against docker-compose services (CI and developers).
 * smoke: runs against a deployed environment (staging after each merge, section 24.7).
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const port = Number(process.env.E2E_PORT ?? 3100);

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
    : {
        command: "pnpm --filter @verilo/web start",
        url: `http://localhost:${port}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", APP_BASE_URL: `http://localhost:${port}`, RATE_LIMIT_DISABLED: "1" } as Record<string, string>,
      },
});
