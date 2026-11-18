// @vitest-environment happy-dom
/**
 * The settings page: its groups, and saving each change as it's made without
 * undoing changes made elsewhere.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { DEFAULT_SETTINGS, type Settings } from "./settings";

const BODY = readFileSync("options.html", "utf8")
  .split("<body>")[1]
  .split("<script")[0];

let stored: { settings?: Partial<Settings> };
let storageChanges: ((changes: object, area: string) => void)[];

/**
 * Change the saved settings, as the side panel would.
 *
 * @param change The settings to change.
 */
function saveElsewhere(change: Partial<Settings>): void {
  stored = { settings: { ...stored.settings, ...change } };
  for (const listener of storageChanges)
    listener({ settings: { newValue: stored.settings } }, "local");
}

/**
 * Find an element by its selector.
 *
 * @param selector The selector.
 * @returns The element.
 */
function $(selector: string): HTMLElement {
  return document.querySelector<HTMLElement>(selector)!;
}

/**
 * Find a list's text box by its selector.
 *
 * @param selector The selector.
 * @returns The text box.
 */
function list(selector: string): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>(selector)!;
}

/**
 * Type into a list.
 *
 * @param selector The list's selector.
 * @param value Its new text.
 */
function type(selector: string, value: string): void {
  const box = list(selector);
  box.value = value;
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Click a checkbox.
 *
 * @param selector The checkbox's selector.
 */
function click(selector: string): void {
  $(selector).click();
}

/** Load a fresh settings page. */
async function start(): Promise<void> {
  await import("./options");
  await vi.waitFor(() => expect($('input[value="EMAIL"]')).not.toBeNull());
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  document.body.innerHTML = BODY;
  stored = {};
  storageChanges = [];
  vi.stubGlobal("chrome", {
    runtime: { getManifest: () => ({ version: "1.2.3" }) },
    storage: {
      local: {
        get: async () => structuredClone(stored),
        set: async (items: typeof stored) => {
          stored = structuredClone(items);
        },
      },
      onChanged: {
        addListener: (listener: (typeof storageChanges)[number]) =>
          storageChanges.push(listener),
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("groups the types by how accurately they're found, each with a tooltip", async () => {
  await start();
  const groups = [...document.querySelectorAll("#types fieldset")];
  expect(
    groups.map(
      (group) => group.querySelector("legend")!.firstChild!.textContent,
    ),
  ).toEqual([
    "Pattern matched",
    "Best with a label",
    "Best guess",
    "May over-flag",
  ]);
  const info = groups[3].querySelector(".info")!;
  const tip = document.getElementById(info.getAttribute("aria-describedby")!)!;
  expect(tip.getAttribute("role")).toBe("tooltip");
  expect(tip.textContent).toContain("Off by default");
  expect(document.querySelector(".hint")).toBeNull();
  expect(document.querySelector("#save")).toBeNull();
});

test("shows the version and where to get help", async () => {
  await start();
  expect($("#version").textContent).toBe("version 1.2.3");
  expect(document.querySelector('a[href="mailto:help@datafog.ai"]')).not.toBe(
    null,
  );
});

test("saves a checkbox right away, and only what it changed", async () => {
  await start();
  saveElsewhere({ allowlist: ["me@work.example"] });

  click('input[value="PHONE"]');
  await vi.waitFor(() => expect($("#status").textContent).toBe("Saved"));

  expect(stored.settings?.entities?.toSorted()).toEqual(
    [...DEFAULT_SETTINGS.entities, "PHONE"].toSorted(),
  );
  expect(stored.settings?.allowlist).toEqual(["me@work.example"]);

  click("#site-claude");
  click("#block-sends");
  await vi.waitFor(() => expect(stored.settings?.blockSends).toBe(true));
  expect(stored.settings?.off).toEqual(["claude.ai"]);
  await vi.advanceTimersByTimeAsync(1500);
  expect($("#status").textContent).toBe("");
});

test("says when a change couldn't be saved, and keeps saving later ones", async () => {
  await start();
  const { set } = chrome.storage.local;
  chrome.storage.local.set = () => Promise.reject(new Error("quota"));
  click('input[value="DATE"]');
  await vi.waitFor(() =>
    expect($("#status").textContent).toBe("Couldn't save. Try again."),
  );
  expect($("#status").classList.contains("failed")).toBe(true);

  chrome.storage.local.set = set;
  click('input[value="UUID"]');
  await vi.waitFor(() => expect($("#status").textContent).toBe("Saved"));
  expect(stored.settings?.entities).toContain("DATE");
  expect($("#status").classList.contains("failed")).toBe(false);
});

test("restores the default sites, types and behavior, keeping the lists", async () => {
  stored = {
    settings: {
      off: ["claude.ai"],
      entities: ["EMAIL", "PHONE"],
      blockSends: true,
      allowlist: ["me@work.example"],
      denylist: ["Acme"],
    },
  };
  await start();
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  click("#restore");
  await vi.advanceTimersByTimeAsync(0);
  expect(confirm).toHaveBeenCalledOnce();
  expect(stored.settings?.off).toEqual(["claude.ai"]);

  confirm.mockReturnValue(true);
  click("#restore");
  await vi.waitFor(() => expect($("#status").textContent).toBe("Saved"));
  expect(stored.settings).toMatchObject({
    off: [],
    entities: DEFAULT_SETTINGS.entities,
    blockSends: false,
    allowlist: ["me@work.example"],
    denylist: ["Acme"],
  });
  const checked = [
    ...document.querySelectorAll<HTMLInputElement>("#types input:checked"),
  ].map((box) => box.value);
  expect(checked.toSorted()).toEqual(DEFAULT_SETTINGS.entities.toSorted());
  expect(
    document.querySelector<HTMLInputElement>("#site-claude")!.checked,
  ).toBe(true);
  expect(
    document.querySelector<HTMLInputElement>("#block-sends")!.checked,
  ).toBe(false);
  expect(list("#denylist").value).toBe("Acme");
});

test("saves a list once typing stops, trimmed and without repeats", async () => {
  await start();
  type("#denylist", " Project Falcon \nProject Falcon\n\nAcme");
  await vi.advanceTimersByTimeAsync(300);
  expect(stored.settings?.denylist).toBeUndefined();

  await vi.advanceTimersByTimeAsync(100);
  await vi.waitFor(() =>
    expect(stored.settings?.denylist).toEqual(["Project Falcon", "Acme"]),
  );
  expect($("#status").textContent).toBe("Saved");
});

test("saves a list right away when it loses focus", async () => {
  await start();
  type("#allowlist", "me@work.example");
  $("#allowlist").dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() =>
    expect(stored.settings?.allowlist).toEqual(["me@work.example"]),
  );
});

test("shows a list changed in the side panel, unless it's being edited", async () => {
  await start();
  saveElsewhere({ denylist: ["Acme"] });
  await vi.waitFor(() => expect(list("#denylist").value).toBe("Acme"));

  type("#allowlist", "draft");
  saveElsewhere({ allowlist: ["me@work.example"] });
  await vi.advanceTimersByTimeAsync(0);
  expect(list("#allowlist").value).toBe("draft");
});
