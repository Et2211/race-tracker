import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the production build in fixture mode: recorded data only, no network,
// and an empty store so nothing cached on this machine leaks into the result.
const PORT = 3200;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/catalog`,
    reuseExistingServer: false,
    env: { F1_DATA_MODE: "fixtures", STORE_DIR: ".cache/e2e-store" },
  },
});
