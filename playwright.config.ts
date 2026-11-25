import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/live/**",
  projects: [{ name: "extension-integration" }],
  // Each profile starts the bundled models cold on shared CI runners.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 20_000 : 5_000 },
  // Every test launches its own headless browser and profile, with its own
  // clipboard and focus, so tests can run side by side. They mostly wait on
  // the browser, so CI runs 4 workers even on 3-core macOS runners.
  workers: process.env.CI ? 4 : undefined,
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: { headless: true },
});
