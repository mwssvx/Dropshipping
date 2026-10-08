import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// The merchant app's web build (apps/mobile, `pnpm --filter @sf/mobile export:web`) for app.spec.ts.
const APP_PORT = 3200;
// Fresh database per run.
const DATA_DIR = `.data/e2e-${Date.now()}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      // Made-up custom domains for the domain tests resolve to this machine.
      args: ["--host-resolver-rules=MAP *.lamptest 127.0.0.1"],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /app\.spec/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testIgnore: /app\.spec/ },
    { name: "app", use: { ...devices["Pixel 7"], baseURL: `http://localhost:${APP_PORT}` }, testMatch: /app\.spec/ },
  ],
  webServer: [{
    command: `next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    env: { DATA_DIR, STAFF_EMAILS: "staff-desktop@example.com,staff-phone@example.com,staff-m5-desktop@example.com,staff-m5-phone@example.com,staff-m8-desktop@example.com,staff-m8-phone@example.com", ANTHROPIC_API_KEY: "", PUSH_PROVIDER: "log", WEBHOOKS_ALLOW_PRIVATE: "on", EMAIL_PREVIEW: "on", FX_PROVIDER: "static", APP_WEB_ORIGINS: `http://localhost:${APP_PORT}`, PAYMENTS_PROVIDER: "fake", DEMO_SUPPLIER: "on", DOMAIN_CHECKS: "off", NEXT_PUBLIC_ROOT_DOMAIN: `localhost:${PORT}` },
    timeout: 60_000,
  }, {
    command: `node e2e/serve-app.mjs ${APP_PORT}`,
    url: `http://localhost:${APP_PORT}`,
    reuseExistingServer: false,
  }],
});
