// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import type { VaultStatus } from "./messages";
const BODY = readFileSync("panel.html", "utf8")
  .split("<body>")[1]
  .split("<script")[0];
const READY: VaultStatus = {
  state: "unlocked",
  access: "ready",
  waiting: false,
  review: null,
  reviewError: null,
  rememberedUntil: null,
  notSensitive: [],
  originals: [],
};
let send: ReturnType<typeof vi.fn>;
let settings = { ...DEFAULT_SETTINGS };
let listener: (message: object) => void;
const $ = (id: string) => document.getElementById(id)!;
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
async function start(
  reply: (request: { type: string; [key: string]: unknown }) => unknown = () =>
    READY,
): Promise<void> {
  send.mockImplementation(async (request) => {
    if (request.type === "settings-get") return settings;
    if (request.type === "settings-save") {
      settings = request.settings;
      return {};
    }
    if (request.type === "update-status") return { ready: false };
    return reply(request);
  });
  await import("./panel");
  await settle();
}
function fill(id: string, value: string): void {
  $(id).dispatchEvent(new Event("focus"));
  document.querySelector<HTMLInputElement>(`#${id}`)!.value = value;
  $(id).dispatchEvent(new Event("input", { bubbles: true }));
}
async function submit(id: string): Promise<void> {
  $(id).dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
}
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = BODY;
  settings = structuredClone(DEFAULT_SETTINGS);
  send = vi.fn();
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: send,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
      connect: () => ({
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
      }),
      openOptionsPage: vi.fn(),
      reload: vi.fn(),
    },
    storage: { onChanged: { addListener: vi.fn() } },
    windows: { getCurrent: async () => ({ id: 1 }) },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
test("opens automatic storage without create, lock, review, or latest-answer actions", async () => {
  await start();
  expect($("unlocked").hidden).toBe(false);
  expect($("vault-state").textContent).toContain("ready");
  for (const id of [
    "create",
    "lock",
    "approve",
    "restore-latest",
    "copy-restored",
  ])
    expect($(id)).toBeNull();
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "vault-create" }),
  );
});
test("keeps views independent and renders sensitive values as text", async () => {
  await start(() => ({
    ...READY,
    originals: [
      { entityType: "EMAIL", original: "<b>value</b>", marker: "[[EMAIL_A]]" },
    ],
  }));
  expect($("originals").textContent).toContain("<b>value</b>");
  expect($("originals").querySelector("b")).toBeNull();
  document.querySelector<HTMLElement>('[data-view="rules"]')!.click();
  expect(
    document.querySelector<HTMLElement>('[data-section="data"]')!.hidden,
  ).toBe(true);
  expect(
    document.querySelector<HTMLElement>('[data-section="rules"]')!.hidden,
  ).toBe(false);
});
test("failed access offers retry without creating or deleting data", async () => {
  let failed = true;
  await start(() => (failed ? { error: "automatic_key_missing" } : READY));
  expect($("retry-access").hidden).toBe(false);
  expect($("unlocked").hidden).toBe(true);
  expect(document.querySelector('input[type="password"]')).toBeNull();
  failed = false;
  $("retry-access").click();
  await settle();
  expect($("unlocked").hidden).toBe(false);
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "vault-delete" }),
  );
});
test("saves rules through the encrypted settings contract", async () => {
  await start();
  fill("denylist-value", "Project Mercury");
  await submit("denylist-add");
  expect(settings.denylist).toEqual(["Project Mercury"]);
  expect($("denylist").textContent).toContain("Project Mercury");
  // Sites and holding sends live on the settings page, not here
  expect($("block-sends")).toBeNull();
  expect(document.querySelector('[data-view="preferences"]')).toBeNull();
  $("settings").click();
  expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
});
test("refreshes retained exact type exceptions on a committed-policy notice", async () => {
  let choice = false;
  await start(() => ({
    ...READY,
    notSensitive: choice
      ? [{ entityType: "EMAIL", value: "me@example.com" }]
      : [],
  }));
  choice = true;
  listener({ target: "panel", type: "vault-changed" });
  await settle();
  expect($("not-sensitive").textContent).toContain("me@example.com");
});
