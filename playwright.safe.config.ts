import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /safe-.*\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "node test/hermes-fake-gateway.mjs",
      url: "http://127.0.0.1:19119",
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...process.env,
        HERMES_FAKE_PORT: "19119",
      },
    },
    {
      command:
        "rm -rf .jarvis/e2e-safe-data && mkdir -p .jarvis && printf '%s' 'ws://127.0.0.1:19119/api/ws' > .jarvis/e2e-hermes-url && npx next dev --hostname 127.0.0.1 --port 3001",
      url: "http://127.0.0.1:3001",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        JARVIS_SAFE_AGENT_CORE: "1",
        JARVIS_DATA_DIR: ".jarvis/e2e-safe-data",
        HERMES_E2E_GATEWAY_URL: "ws://127.0.0.1:19119/api/ws",
        HERMES_GATEWAY_URL: "ws://127.0.0.1:19119/api/ws",
        HERMES_GATEWAY_HTTP: "http://127.0.0.1:19119",
        WATCHPACK_POLLING: "1",
        CHOKIDAR_USEPOLLING: "true",
      },
    },
  ],
  projects: [
    {
      name: "chromium-safe",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
