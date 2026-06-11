import { defineConfig, devices } from "@playwright/test";

// Hermetic E2E suite. Two web servers:
//   1. test/e2e/e2e-api-server.mjs — the Review API with an in-memory Sanity
//      client (seeded fixtures, zero real network credentials).
//   2. Vite dev server on 5200 (the frontend hardcodes localhost:8787 for
//      /api/public in dev and proxies /api/review there, so the fake API
//      must own port 8787).
//
// reuseExistingServer is intentionally false for the API server even
// locally: if a developer's real `npm run api:dev` (connected to real
// Sanity) is already on 8787, the run must fail loudly rather than silently
// test against production data. Stop your local API before running e2e.
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "**/*.spec.mjs",
  fullyParallel: true,
  retries: isCI ? 2 : 0,
  forbidOnly: isCI,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://localhost:5200",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node test/e2e/e2e-api-server.mjs",
      url: "http://localhost:8787/api/public/therapists",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run dev",
      url: "http://localhost:5200/",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        // Make sure the client-side Turnstile widget never mounts, even if a
        // local .env ever grows a site key. Empty string wins over .env in
        // Vite's env resolution.
        VITE_TURNSTILE_SITE_KEY: "",
      },
    },
  ],
});
