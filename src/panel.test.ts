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

const ORIGINAL = {
  entityType: "EMAIL",
  original: "jane@example.com",
  marker: "[[EMAIL_A]]",
};
function rowButton(action: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(
    `#originals [data-action="${action}"]`,
  )!;
}
function openOriginalMenu(): void {
  document.querySelector<HTMLButtonElement>(".original-menu-toggle")!.click();
}
test("original menu copies safely, handles clipboard failure and restores focus on Escape", async () => {
  const writeText = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockRejectedValueOnce(new Error("denied"))
    .mockResolvedValue(undefined);
  await start(() => ({ ...READY, originals: [ORIGINAL] }));
  openOriginalMenu();
  expect(document.activeElement).toBe(rowButton("copy"));
  rowButton("copy").click();
  await settle();
  expect($("originals").textContent).toContain("Couldn't copy");
  rowButton("copy").click();
  await settle();
  expect(writeText).toHaveBeenLastCalledWith(ORIGINAL.original);
  expect($("originals").textContent).toContain("Copied");
  openOriginalMenu();
  rowButton("copy").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(document.querySelector<HTMLElement>(".original-menu")!.hidden).toBe(
    true,
  );
  expect(document.activeElement).toBe(
    document.querySelector(".original-menu-toggle"),
  );
});
test("original Always allow saves the typed choice and hides the action after confirmed refresh", async () => {
  let allowed = false;
  await start((request) => {
    if (request.type === "always-allow") {
      expect(request).toEqual({
        type: "always-allow",
        entityType: "EMAIL",
        value: ORIGINAL.original,
      });
      allowed = true;
    }
    return {
      ...READY,
      originals: [ORIGINAL],
      notSensitive: allowed
        ? [{ entityType: "EMAIL", value: ORIGINAL.original }]
        : [],
    };
  });
  openOriginalMenu();
  rowButton("allow").click();
  await settle();
  expect($("originals").querySelector(".allowed")!.textContent).toBe("Allowed");
  expect(rowButton("allow")).toBeNull();
});
test("forget requires row confirmation, preserves data on cancel/failure and retries", async () => {
  let fail = true;
  let forgotten = false;
  await start((request) => {
    if (request.type === "forget-original") {
      if (fail) return { error: "write_failed" };
      forgotten = true;
    }
    return { ...READY, originals: forgotten ? [] : [ORIGINAL] };
  });
  openOriginalMenu();
  rowButton("forget").click();
  expect(document.activeElement).toBe(rowButton("cancel-forget"));
  rowButton("cancel-forget").click();
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "forget-original" }),
  );
  openOriginalMenu();
  rowButton("forget").click();
  rowButton("confirm-forget").click();
  await settle();
  expect($("originals").textContent).toContain("Forget could not be confirmed");
  expect($("originals").textContent).toContain(ORIGINAL.original);
  fail = false;
  rowButton("confirm-forget").click();
  await settle();
  expect(send).toHaveBeenCalledWith({
    type: "forget-original",
    marker: ORIGINAL.marker,
  });
  expect($("originals").children).toHaveLength(0);
  expect($("save-status").textContent).toBe("Forgotten");
});

test("forget disables duplicate confirmation and invalidates an in-flight lookup on vault refresh", async () => {
  let finishForget!: (value: unknown) => void;
  let finishLookup!: (value: unknown) => void;
  await start((request) =>
    request.type === "forget-original"
      ? new Promise((done) => {
          finishForget = done;
        })
      : request.type === "restore"
        ? new Promise((done) => {
            finishLookup = done;
          })
        : { ...READY, originals: [ORIGINAL] },
  );
  fill("lookup-marker", ORIGINAL.marker);
  await submit("lookup");
  openOriginalMenu();
  rowButton("forget").click();
  rowButton("confirm-forget").click();
  expect(rowButton("confirm-forget").disabled).toBe(true);
  rowButton("confirm-forget").click();
  expect(
    send.mock.calls.filter(([request]) => request.type === "forget-original"),
  ).toHaveLength(1);
  listener({ target: "panel", type: "vault-changed" });
  await settle();
  finishLookup({
    restored: 1,
    text: ORIGINAL.original,
    values: [],
    unrestored: 0,
  });
  await settle();
  expect($("lookup-result").textContent).not.toContain(ORIGINAL.original);
  finishForget({ saved: true });
  await settle();
});
