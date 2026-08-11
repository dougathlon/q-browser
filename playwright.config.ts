import { defineConfig, devices } from "@playwright/test";

const runBuilt = process.env.Q_E2E_BUILT === "1";
const basePath = (() => {
  const candidate = process.env.VITE_BASE_PATH?.trim() || "/";
  if (candidate === "/") return candidate;
  return `/${candidate.replace(/^\/+|\/+$/g, "")}/`;
})();
const serverURL = `http://127.0.0.1:4193${basePath}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: serverURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: runBuilt
      ? "pnpm exec vite preview --host 127.0.0.1 --port 4193 --strictPort"
      : "pnpm exec vite --host 127.0.0.1 --port 4193 --strictPort",
    url: serverURL,
    reuseExistingServer: false,
  },
});
