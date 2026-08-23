import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /safe-.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --port 3001",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      JARVIS_SAFE_AGENT_CORE: "1",
      JARVIS_DATA_DIR: ".jarvis/e2e-safe-data",
    },
  },
  projects: [
    {
      name: "chromium-safe",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
