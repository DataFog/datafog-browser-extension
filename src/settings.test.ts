/**
 * Every type the settings offer, or may offer, has a plain-language name, and
 * none appears twice.
 */

import { expect, test, vi } from "vitest";

import {
  addToList,
  DEFAULT_ENTITIES,
  DEFAULT_SETTINGS,
  GERMAN_ENTITIES,
  LABELS,
  loadSettings,
  OPT_IN_ENTITIES,
  removeFromList,
  sameChecks,
  type Settings,
} from "./settings";
import { HOSTS } from "./site";

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
  expect(old.off).toEqual(HOSTS);
  vi.unstubAllGlobals();
});

test("a review no longer holds once the deny list changes", () => {
  const before = { ...DEFAULT_SETTINGS, denylist: ["Project Atlas"] };

  expect(sameChecks(before, { ...before })).toBe(true);
  expect(sameChecks(before, { ...before, denylist: [] })).toBe(false);
});

/**
 * Stub storage holding these settings, saving changes back to it.
 *
 * @param settings The stored settings.
 * @returns The storage, to read what was saved.
 */
function storeOf(settings: object): { settings: object } {
  const store = { settings };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async () => ({ ...store }),
        set: async (next: { settings: object }) => Object.assign(store, next),
      },
    },
  });
  return store;
}

test("adds a list value once, trimmed, and removes it", async () => {
  const store = storeOf({ allowlist: ["me@work.example"] });

  expect(await addToList("denylist", "  Project Atlas ")).toBe("added");
  expect(await addToList("denylist", "Project Atlas")).toBe("listed");
  expect(await addToList("denylist", "   ")).toBe("blank");
  expect(store.settings).toMatchObject({
    allowlist: ["me@work.example"],
    denylist: ["Project Atlas"],
  });
  expect(store.settings).not.toHaveProperty("enabled");

  await removeFromList("allowlist", "me@work.example");
  expect(store.settings).toMatchObject({
    allowlist: [],
    denylist: ["Project Atlas"],
  });
  vi.unstubAllGlobals();
});
