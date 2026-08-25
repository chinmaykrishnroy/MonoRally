import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["line"]] : "line",
  use: {
    baseURL: "http://127.0.0.1:19087",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node server/src/index.js",
    env: {
      PORT: "19087",
      QUICK_MATCH_FALLBACK_MS: "5000"
    },
    url: "http://127.0.0.1:19087",
    reuseExistingServer: !process.env.CI,
    timeout: 15000
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    {
      name: "iPhone 16",
      use: {
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
      }
    },
    {
      name: "iPhone 16 landscape",
      use: {
        viewport: { width: 852, height: 393 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
      }
    },
    {
      name: "tablet",
      use: {
        viewport: { width: 1024, height: 768 },
        deviceScaleFactor: 2,
        hasTouch: true
      }
    }
  ]
});
