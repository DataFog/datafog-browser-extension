import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/live/**",
  projects: [{ name: "extension-integration" }],
  // Clipboard contents and native window focus are shared across profiles.
  // Serialize tests so those OS resources cannot race.
  // Each profile starts the bundled models cold on shared CI runners.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 20_000 : 5_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: { headless: true },
});
