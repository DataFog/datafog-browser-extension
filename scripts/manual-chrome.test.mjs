import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { chromeExecutable, launchManualChrome } from "./manual-chrome.mjs";

describe("manual sign-in Chrome", () => {
  it("launches only the dedicated profile with loopback debugging and no automation flags", () => {
    const child = { once: vi.fn(), kill: vi.fn() };
    const spawn = vi.fn(() => child);
    const profile = path.resolve(".playwright/live-profile");
    expect(launchManualChrome("/installed/chrome", profile, spawn)).toBe(child);
    const [executable, args, options] = spawn.mock.calls[0];
    expect(executable).toBe("/installed/chrome");
    expect(args).toContain(`--user-data-dir=${profile}`);
    expect(args).toContain("--remote-debugging-address=127.0.0.1");
    expect(args).toContain("https://chatgpt.com/");
    expect(
      args.some((arg) =>
        /enable-automation|disable-blink|user-agent|load-extension|headless/.test(
          arg,
        ),
      ),
    ).toBe(false);
    expect(options.stdio).toBe("ignore");
  });
  it("honors an explicit installed executable without falling back to another browser", async () => {
    await expect(
      chromeExecutable("darwin", { CHROME_EXECUTABLE_PATH: process.execPath }),
    ).resolves.toBe(process.execPath);
    await expect(
      chromeExecutable("darwin", {
        CHROME_EXECUTABLE_PATH: "/missing/datafog-test-chrome",
      }),
    ).rejects.toThrow("CHROME_EXECUTABLE_PATH");
  });
});
