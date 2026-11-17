/**
 * Every type the settings offer, or may offer, has a plain-language name, and
 * none appears twice.
 */

import { expect, test, vi } from "vitest";

import {
  DEFAULT_ENTITIES,
  GERMAN_ENTITIES,
  LABELS,
  loadSettings,
  OPT_IN_ENTITIES,
  type Settings,
} from "./settings";

const OFFERED = [...DEFAULT_ENTITIES, ...OPT_IN_ENTITIES, ...GERMAN_ENTITIES];

test("names every offered type", () => {
  expect(OFFERED.filter((type) => !LABELS[type])).toEqual([]);
});

test("offers each type once", () => {
  expect(new Set(OFFERED).size).toBe(OFFERED.length);
});

/**
 * Load settings as a page on a site would.
 *
 * @param settings What's saved.
 * @param host The site.
 * @returns The settings for that site.
 */
async function load(settings: object, host?: string): Promise<Settings> {
  vi.stubGlobal("chrome", {
    storage: { local: { get: async () => ({ settings }) } },
  });
  return loadSettings(host);
}

test("turns checking off per site, and keeps an old off switch as off everywhere", async () => {
  expect((await load({ off: ["claude.ai"] }, "claude.ai")).enabled).toBe(false);
  expect((await load({ off: ["claude.ai"] }, "chatgpt.com")).enabled).toBe(
    true,
  );
  expect((await load({}, "claude.ai")).enabled).toBe(true);
  const old = await load({ enabled: false }, "chatgpt.com");
  expect(old.enabled).toBe(false);
  expect(old.off).toEqual(["chatgpt.com", "claude.ai"]);
  vi.unstubAllGlobals();
});
