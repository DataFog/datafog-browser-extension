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

let stored: { settings?: Partial<Settings>; theme?: string };
let deleteReply: () => object = () => ({ state: "none" });
const sent: string[] = [];
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
    runtime: {
      getManifest: () => ({ version: "1.2.3" }),
      sendMessage: async (request: { type: string; settings?: Settings }) => {
        sent.push(request.type);
        if (request.type === "settings-get")
          return { ...DEFAULT_SETTINGS, ...stored.settings };
        if (request.type === "vault-delete") return deleteReply();
        if (request.type === "settings-save") {
          await chrome.storage.local.set({ settings: request.settings });
          return {};
        }
        return {};
      },
    },
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

test("restores the default sites, types and behavior, keeping the rules", async () => {
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
});

test("has no list editors: rules live in the sidebar", async () => {
  await start();
  expect(document.querySelector("#allowlist")).toBeNull();
  expect(document.querySelector("#denylist")).toBeNull();
});

test("saves the theme locally and marks the page with it", async () => {
  await start();
  const dark = document.querySelector<HTMLInputElement>(
    'input[name="theme"][value="dark"]',
  )!;
  dark.checked = true;
  dark.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect($("#status").textContent).toBe("Saved"));
  expect(stored.theme).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  // Theme is not part of the encrypted settings
  expect(stored.settings).toBeUndefined();
});

test("deleting vault data needs DELETE typed, and cancelling keeps it", async () => {
  sent.length = 0;
  await start();
  $("#delete-open").click();
  expect($("#delete").hidden).toBe(false);
  const confirm = document.querySelector<HTMLInputElement>("#delete-confirm")!;
  confirm.value = "RESET";
  confirm.dispatchEvent(new Event("input"));
  expect(
    document.querySelector<HTMLButtonElement>("#delete-submit")!.disabled,
  ).toBe(true);
  $("#delete").dispatchEvent(new Event("submit", { cancelable: true }));
  $("#delete-cancel").click();
  expect($("#delete").hidden).toBe(true);
  expect(sent).not.toContain("vault-delete");

  $("#delete-open").click();
  confirm.value = "delete";
  confirm.dispatchEvent(new Event("input"));
  $("#delete").dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() =>
    expect($("#delete-status").textContent).toContain("deleted"),
  );
  expect(sent).toContain("vault-delete");
});

test("reports a partial deletion as one", async () => {
  deleteReply = () => ({ error: "vault_deletion_incomplete" });
  await start();
  $("#delete-open").click();
  const confirm = document.querySelector<HTMLInputElement>("#delete-confirm")!;
  confirm.value = "DELETE";
  confirm.dispatchEvent(new Event("input"));
  $("#delete").dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() =>
    expect($("#delete-status").textContent).toContain("Some data may remain"),
  );
  expect($("#delete-open").hidden).toBe(false);
  deleteReply = () => ({ state: "none" });
});

test("paste replacement is opt-in, saved with other encrypted preferences and reset with behavior", async () => {
  await start();
  const control = document.querySelector<HTMLInputElement>(
    "#auto-replace-on-paste",
  )!;
  expect(control.checked).toBe(false);
  saveElsewhere({ allowlist: ["keep@example.com"] });
  control.click();
  await vi.waitFor(() =>
    expect(stored.settings?.autoReplaceOnPaste).toBe(true),
  );
  expect(stored.settings?.allowlist).toEqual(["keep@example.com"]);
  vi.stubGlobal("confirm", () => true);
  click("#restore");
  await vi.waitFor(() =>
    expect(stored.settings?.autoReplaceOnPaste).toBe(false),
  );
  expect(stored.settings?.allowlist).toEqual(["keep@example.com"]);
});

test("shows Rampart for legacy settings and preserves an explicit CNN choice", async () => {
  stored = { settings: {} };
  await start();
  const select = document.querySelector<HTMLSelectElement>("#detector")!;
  expect(select.value).toBe("rampart");
  select.value = "cnn";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(stored.settings?.detector).toBe("cnn"));
});

test("loads an existing CNN selection and resets it to the Rampart default", async () => {
  stored = { settings: { detector: "cnn" } };
  await start();
  const select = document.querySelector<HTMLSelectElement>("#detector")!;
  expect(select.value).toBe("cnn");
  vi.stubGlobal("confirm", () => true);
  click("#restore");
  await vi.waitFor(() => expect(stored.settings?.detector).toBe("rampart"));
  expect(select.value).toBe("rampart");
});
