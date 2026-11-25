import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/live/**",
  projects: [{ name: "extension-integration" }],
  // Each profile starts the bundled models cold on shared CI runners.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 20_000 : 5_000 },
  // Each test uses every core of a hosted runner, so CI runs one at a time
  // and splits tests across runners instead. Splitting by test rather than
  // by file keeps those shards even.
  workers: process.env.CI ? 1 : undefined,
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: { headless: true },
});
