import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// Fresh database per run.
const DATA_DIR = `.data/e2e-${Date.now()}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    env: { DATA_DIR, PAYMENTS_PROVIDER: "fake", DEMO_SUPPLIER: "on", NEXT_PUBLIC_ROOT_DOMAIN: `localhost:${PORT}` },
    timeout: 60_000,
  },
});
