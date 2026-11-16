import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/live",
  // A single test account, OS clipboard and window focus are shared resources.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["./e2e/live/receipt-reporter.ts"]],
  outputDir: "test-results/live",
  use: {
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
