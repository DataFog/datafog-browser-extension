// @vitest-environment happy-dom
/**
 * The side panel: its connection to the service worker, the vault and the
 * Pseudonymize review.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { PanelRequest, VaultStatus } from "./messages";

const BODY = readFileSync("panel.html", "utf8")
  .split("<body>")[1]
  .split("<script")[0];

type Reply = (request: PanelRequest) => unknown;

const LOCKED: VaultStatus = {
  state: "locked",
  waiting: false,
  review: null,
  reviewError: null,
  rememberedUntil: null,
  notSensitive: [],
};

let notices: ((message: object) => void)[];
let sendMessage: ReturnType<typeof vi.fn<(request: PanelRequest) => unknown>>;

/** Let pending requests and renders finish. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Load a fresh side panel.
 *
 * @param reply How the stubbed service worker answers each request.
 */
async function start(reply: Reply): Promise<void> {
  sendMessage.mockImplementation(async (request) => reply(request));
  await import("./panel");
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
  await settle();
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
 * Fill in a password field.
 *
 * @param selector The field's selector.
 * @param value The password.
 */
function fill(selector: string, value: string): void {
  const field = document.querySelector<HTMLInputElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Submit a form.
 *
 * @param selector The form's selector.
 */
async function submit(selector: string): Promise<void> {
  document
    .querySelector<HTMLFormElement>(selector)!
    .dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = BODY;
  notices = [];
  sendMessage = vi.fn();
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        connect: vi.fn(() => ({
          onMessage: { addListener: vi.fn() },
          onDisconnect: { addListener: vi.fn() },
        })),
        onMessage: {
          addListener: (added: (message: object) => void) =>
            notices.push(added),
        },
        openOptionsPage: vi.fn(),
        sendMessage,
      },
      windows: { getCurrent: vi.fn(async () => ({ id: 3 })) },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("closes when told to, and reconnects when the worker stops", async () => {
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  const messages: (() => void)[] = [];
  const drops: (() => void)[] = [];
  const connect = vi.fn(() => ({
    onMessage: { addListener: (added: () => void) => messages.push(added) },
    onDisconnect: { addListener: (added: () => void) => drops.push(added) },
  }));
  Object.assign(chrome.runtime, { connect });

  await start(() => LOCKED);
  await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
  expect(connect).toHaveBeenCalledWith({ name: "3" });

  drops[0]();
  await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));

  messages[1]();
  expect(close).toHaveBeenCalled();
});

test("offers to create a vault when there isn't one", async () => {
  await start(() => ({ ...LOCKED, state: "none" }));

  expect($("#vault-state").hidden).toBe(true);
  expect($("#reset-open").hidden).toBe(true);
  expect($("#create").hidden).toBe(false);
  expect($("#unlock").hidden).toBe(true);
  expect($("#review").hidden).toBe(true);
});

test("shows each password rule as it's met", async () => {
  await start(() => ({ ...LOCKED, state: "none" }));
  const submitButton =
    document.querySelector<HTMLButtonElement>("#create-submit")!;

  expect($("#rule-length").className).toBe("");
  expect(submitButton.disabled).toBe(true);

  fill("#create-password", "short");
  expect($("#rule-length").className).toBe("unmet");

  fill("#create-password", "correct horse");
  fill("#create-confirm", "correct house");
  expect($("#rule-length").className).toBe("met");
  expect($("#rule-match").className).toBe("unmet");
  await submit("#create");
  expect(sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "vault-create" }),
  );

  fill("#create-confirm", "correct horse");
  expect($("#rule-match").className).toBe("met");
  expect(submitButton.disabled).toBe(false);
});

test("hides what the vault does behind the info button", async () => {
  await start(() => LOCKED);
  const toggle = $("#vault-info-toggle");

  expect($("#vault-state").getAttribute("aria-label")).toBe("Locked");
  expect($("#vault-info").hidden).toBe(true);

  toggle.click();
  expect($("#vault-info").hidden).toBe(false);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect($("#vault-info a").getAttribute("href")).toBe(
    "https://docs.datafog.ai",
  );
});

test("shows the recovery key once, then the unlocked vault", async () => {
  await start((request) =>
    request.type === "vault-create"
      ? { status: { ...LOCKED, state: "unlocked" }, recoveryKey: "S2V5" }
      : { ...LOCKED, state: "none" },
  );

  fill("#create-password", "correct horse");
  fill("#create-confirm", "correct horse");
  await submit("#create");

  expect(sendMessage).toHaveBeenCalledWith({
    type: "vault-create",
    password: "correct horse",
    remember: false,
  });
  expect($("#recovery").hidden).toBe(false);
  expect($("#recovery-key").textContent).toBe("S2V5");
  expect($("#recovery-note").textContent).toContain(
    "If you lose both your password and this key, no one can open your vault",
  );
  expect($("#unlocked").hidden).toBe(true);
  expect(
    document.querySelector<HTMLInputElement>("#create-password")!.value,
  ).toBe("");

  sendMessage.mockImplementation(async () => ({
    ...LOCKED,
    state: "unlocked",
  }));
  $("#saved-key").click();
  await settle();

  expect($("#recovery").hidden).toBe(true);
  expect($("#recovery-key").textContent).toBe("");
  expect($("#unlocked").hidden).toBe(false);
});

test("unlocks with the password, and says when that fails", async () => {
  await start((request) =>
    request.type === "vault-unlock" ? { error: "Integrity" } : LOCKED,
  );

  expect($("#unlock").hidden).toBe(false);
  fill("#unlock-password", "wrong password");
  await submit("#unlock");

  expect(sendMessage).toHaveBeenCalledWith({
    type: "vault-unlock",
    password: "wrong password",
    remember: false,
  });
  expect($("#vault-error").textContent).toBe(
    "Something went wrong. Error code: Integrity",
  );
});

test("says plainly when the password is wrong", async () => {
  await start((request) =>
    request.type === "vault-unlock" ? { error: "Authentication" } : LOCKED,
  );

  fill("#unlock-password", "wrong password");
  await submit("#unlock");

  expect($("#vault-error").textContent).toBe("That password isn't right.");
});

test("lists each value and its marker, as text", async () => {
  await start(() => ({
    ...LOCKED,
    state: "unlocked",
    review: [
      {
        entityType: "EMAIL",
        original: "<b>jane@example.com</b>",
        marker: "[[EMAIL_7KQ4ZM]]",
      },
    ],
  }));

  expect($("#review").hidden).toBe(false);
  expect($("#approve").hidden).toBe(false);
  const item = document.querySelector("#review-items li")!;
  expect(item.querySelector("b")).toBeNull();
  expect(item.textContent).toContain("<b>jane@example.com</b>");
  expect(item.textContent).toContain("→ [[EMAIL_7KQ4ZM]]");
});

test("marks a review value not sensitive", async () => {
  const review = [
    { entityType: "PERSON", original: "Ann", marker: "[[PERSON_7KQ4ZM]]" },
  ];
  let status: VaultStatus = { ...LOCKED, state: "unlocked", review };
  await start((request) => {
    if (request.type === "review-not-sensitive") {
      status = {
        ...status,
        review: null,
        notSensitive: [{ entityType: "PERSON", value: "Ann" }],
      };
    }
    return status;
  });

  $("#review-items li button").click();
  await settle();

  expect(sendMessage).toHaveBeenCalledWith({
    type: "review-not-sensitive",
    index: 0,
  });
  expect($("#not-sensitive").textContent).toContain("Ann");
});

test("lists not sensitive values as text, and removes one", async () => {
  const choice = { entityType: "PERSON", value: "<i>Ann</i>" };
  let status: VaultStatus = {
    ...LOCKED,
    state: "unlocked",
    notSensitive: [choice],
  };
  await start((request) => {
    if (request.type === "choice-clear") {
      status = { ...status, notSensitive: [] };
    }
    return status;
  });

  const item = document.querySelector("#not-sensitive li")!;
  expect(item.querySelector("i")).toBeNull();
  expect(item.textContent).toContain("<i>Ann</i>");
  expect(item.textContent).toContain("Name");

  item.querySelector("button")!.click();
  await settle();

  expect(sendMessage).toHaveBeenCalledWith({ type: "choice-clear", ...choice });
  expect($("#not-sensitive").children).toHaveLength(0);
  expect($("#not-sensitive-note").textContent).toBe(
    "No values marked not sensitive yet.",
  );
});

test("hides what not sensitive values do behind an info button", async () => {
  await start(() => LOCKED);
  const toggle = $("#not-sensitive-info-toggle");

  expect($("#not-sensitive-info").hidden).toBe(true);
  toggle.click();
  expect($("#not-sensitive-info").hidden).toBe(false);
  expect($("#vault-info").hidden).toBe(true);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
});

test("scrolls a long list of not sensitive values within the panel", async () => {
  const notSensitive = Array.from({ length: 8 }, (_, index) => ({
    entityType: "EMAIL",
    value: `person${index}@example.com`,
  }));
  await start(() => ({ ...LOCKED, state: "unlocked", notSensitive }));

  expect($("#not-sensitive").childElementCount).toBe(8);
  expect($("#not-sensitive").classList.contains("scroll")).toBe(true);
  expect($("#not-sensitive-count").textContent).toBe(
    "8 values. Scroll the list to see them all.",
  );
});

test("asks to unlock before showing not sensitive values", async () => {
  await start(() => LOCKED);

  expect($("#not-sensitive-note").textContent).toContain("Unlock your vault");
});

test("asks to unlock when Pseudonymize is waiting", async () => {
  await start(() => ({ ...LOCKED, waiting: true }));

  expect($("#review").hidden).toBe(false);
  expect($("#approve").hidden).toBe(true);
  expect($("#review-note").textContent).toBe(
    "Unlock your vault below to review the values to pseudonymize.",
  );
});

test("approves the review, and explains a changed chat box", async () => {
  const review = [
    {
      entityType: "EMAIL",
      original: "jane@example.com",
      marker: "[[EMAIL_7KQ4ZM]]",
    },
  ];
  let status: VaultStatus = { ...LOCKED, state: "unlocked", review };
  await start((request) => {
    if (request.type !== "review-approve") return status;
    status = { ...status, review: null };
    return { error: "chat_box_changed" };
  });

  $("#approve").click();
  await settle();

  expect(sendMessage).toHaveBeenCalledWith({ type: "review-approve" });
  expect($("#review-items").childElementCount).toBe(0);
  expect($("#review-error").textContent).toBe(
    "The chat box changed after this review was prepared. Choose Pseudonymize again.",
  );
});

test("refreshes when the vault says it changed", async () => {
  let status: VaultStatus = { ...LOCKED, state: "unlocked" };
  await start(() => status);
  expect($("#unlocked").hidden).toBe(false);

  status = LOCKED;
  notices.forEach((notice) =>
    notice({ target: "panel", type: "vault-changed" }),
  );
  await settle();

  expect($("#unlocked").hidden).toBe(true);
  expect($("#unlock").hidden).toBe(false);
});

test("shows an unlocked icon once the vault is unlocked", async () => {
  await start(() => ({ ...LOCKED, state: "unlocked" }));

  expect($("#vault-state").getAttribute("aria-label")).toBe("Unlocked");
  expect($("#vault-state svg")).not.toBeNull();
});

test("resets the vault once RESET is typed, without its password", async () => {
  let status: VaultStatus = { ...LOCKED, state: "unlocked" };
  await start((request) => {
    if (request.type !== "vault-reset") return status;
    status = { ...LOCKED, state: "none" };
    return status;
  });

  $("#reset-open").click();
  expect($("#reset").hidden).toBe(false);
  expect($("#unlocked").hidden).toBe(true);
  expect($("#reset-submit")).toHaveProperty("disabled", true);

  fill("#reset-confirm", "rese");
  expect($("#reset-submit")).toHaveProperty("disabled", true);
  await submit("#reset");
  expect(sendMessage).not.toHaveBeenCalledWith({ type: "vault-reset" });

  fill("#reset-confirm", " reset ");
  expect($("#reset-submit")).toHaveProperty("disabled", false);
  await submit("#reset");
  expect(sendMessage).toHaveBeenCalledWith({ type: "vault-reset" });
  expect($("#reset").hidden).toBe(true);
  expect($("#create").hidden).toBe(false);
});

test("sets a new password with the recovery key, then shows the new key", async () => {
  await start((request) =>
    request.type === "vault-recover"
      ? { status: { ...LOCKED, state: "unlocked" }, recoveryKey: "TmV3" }
      : LOCKED,
  );

  expect($("#recover").hidden).toBe(true);
  $("#recover-open").click();
  expect($("#recover").hidden).toBe(false);
  expect($("#unlock").hidden).toBe(true);
  expect($("#reset-open").hidden).toBe(true);

  fill("#recover-key", "S2V5");
  fill("#recover-password", "new password");
  expect($("#recover-submit")).toHaveProperty("disabled", true);
  fill("#recover-confirm", "new password");
  expect($("#recover-submit")).toHaveProperty("disabled", false);
  await submit("#recover");

  expect(sendMessage).toHaveBeenCalledWith({
    type: "vault-recover",
    key: "S2V5",
    password: "new password",
  });
  expect($("#recover").hidden).toBe(true);
  expect($("#recovery-key").textContent).toBe("TmV3");
  expect($("#recovery-note").textContent).toContain(
    "Your new password is set.",
  );
  expect(
    document.querySelector<HTMLTextAreaElement>("#recover-key")!.value,
  ).toBe("");
});

test("says plainly when the recovery key is wrong", async () => {
  await start((request) =>
    request.type === "vault-recover" ? { error: "Integrity" } : LOCKED,
  );

  $("#recover-open").click();
  fill("#recover-key", "S2V5");
  fill("#recover-password", "new password");
  fill("#recover-confirm", "new password");
  await submit("#recover");

  expect($("#vault-error").textContent).toBe(
    "That recovery key doesn't open this vault.",
  );
  expect($("#recover").hidden).toBe(false);
});

test("closes the recovery form on Cancel", async () => {
  await start(() => LOCKED);

  $("#recover-open").click();
  $("#recover-cancel").click();

  expect($("#recover").hidden).toBe(true);
  expect($("#unlock").hidden).toBe(false);
});

test("closes the reset form on Cancel", async () => {
  await start(() => LOCKED);

  $("#reset-open").click();
  $("#reset-cancel").click();

  expect($("#reset").hidden).toBe(true);
  expect($("#unlock").hidden).toBe(false);
  expect(sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "vault-reset" }),
  );
});

test("restores the latest answer in the page, and hides it again", async () => {
  await start((request) => {
    if (request.type === "restore-latest")
      return { text: "To a@b.co", restored: 2, unrestored: 1, shown: 2 };
    if (request.type === "hide-originals") return {};
    return { ...LOCKED, state: "unlocked" };
  });

  $("#restore-latest").click();
  await settle();

  expect(sendMessage).toHaveBeenCalledWith({
    type: "restore-latest",
    windowId: 3,
  });
  expect($("#restored").hidden).toBe(false);
  expect($("#restored-summary").textContent).toBe(
    "Showing 2 original values in ChatGPT's answer. 1 marker couldn't be restored and stayed as is.",
  );

  $("#hide-originals").click();
  await settle();

  expect(sendMessage).toHaveBeenCalledWith({
    type: "hide-originals",
    windowId: 3,
  });
  expect($("#restored").hidden).toBe(true);
});

test("offers Copy when the values can't show in the page", async () => {
  await start((request) =>
    request.type === "restore-latest"
      ? { text: "To a@b.co", restored: 1, unrestored: 0, shown: 0 }
      : { ...LOCKED, state: "unlocked" },
  );

  $("#restore-latest").click();
  await settle();

  expect($("#restored-summary").textContent).toBe(
    "Restored 1 marker, but couldn't show them in the page. Copy the restored answer instead.",
  );
});

test("explains why an answer can't be restored", async () => {
  await start((request) =>
    request.type === "restore-latest"
      ? { error: "no_chat" }
      : { ...LOCKED, state: "unlocked" },
  );

  $("#restore-latest").click();
  await settle();

  expect($("#restore-error").textContent).toBe(
    "Open a ChatGPT chat in this tab to restore its latest answer.",
  );
  expect($("#restored").hidden).toBe(true);
});

test("offers Restore only while unlocked, and clears it on lock", async () => {
  let status: VaultStatus = { ...LOCKED, state: "unlocked" };
  await start((request) =>
    request.type === "restore-latest"
      ? { text: "a@b.co", restored: 1, unrestored: 0, shown: 1 }
      : status,
  );
  $("#restore-latest").click();
  await settle();
  expect($("#restored").hidden).toBe(false);

  status = LOCKED;
  notices.forEach((notice) =>
    notice({ target: "panel", type: "vault-changed" }),
  );
  await settle();

  expect(
    document.querySelector<HTMLButtonElement>("#restore-latest")!.disabled,
  ).toBe(true);
  expect($("#restored").hidden).toBe(true);
});

test("says when none of the answer's markers could be restored", async () => {
  await start((request) =>
    request.type === "restore-latest"
      ? { text: "[[EMAIL_ZZZZZZ]]", restored: 0, unrestored: 2, shown: 0 }
      : { ...LOCKED, state: "unlocked" },
  );

  $("#restore-latest").click();
  await settle();

  expect($("#restored-summary").textContent).toBe(
    "None of the 2 markers in this answer could be restored.",
  );
});

test("scrolls a long review within the panel", async () => {
  const review = Array.from({ length: 12 }, (_, index) => ({
    original: `person${index}@example.com`,
    marker: `[[EMAIL_${String(index).padStart(6, "0")}]]`,
  }));
  await start(() => ({ ...LOCKED, state: "unlocked", review }));

  expect($("#review-items").childElementCount).toBe(12);
  expect($("#review-items").classList.contains("scroll")).toBe(true);
  expect($("#review-count").hidden).toBe(false);
  expect($("#review-count").textContent).toBe(
    "12 values. Scroll the list to see them all.",
  );
});

test("shows a short review in full", async () => {
  const review = Array.from({ length: 5 }, (_, index) => ({
    original: `person${index}@example.com`,
    marker: `[[EMAIL_${String(index).padStart(6, "0")}]]`,
  }));
  await start(() => ({ ...LOCKED, state: "unlocked", review }));

  expect($("#review-items").classList.contains("scroll")).toBe(false);
  expect($("#review-count").hidden).toBe(true);
});

test("remembers the device when asked, and says until when", async () => {
  const until = new Date(2026, 11, 11).getTime();
  await start((request) =>
    request.type === "vault-unlock"
      ? {
          status: { ...LOCKED, state: "unlocked", rememberedUntil: until },
          recoveryKey: null,
        }
      : LOCKED,
  );
  expect(sendMessage).toHaveBeenCalledWith({
    type: "vault-status",
    autoUnlock: true,
  });

  fill("#unlock-password", "correct horse");
  document.querySelector<HTMLInputElement>("#unlock-remember")!.checked = true;
  await submit("#unlock");

  expect(sendMessage).toHaveBeenCalledWith({
    type: "vault-unlock",
    password: "correct horse",
    remember: true,
  });
  expect($("#remembered").hidden).toBe(false);
  expect($("#remembered-until").textContent).toBe(
    `This device is remembered until ${new Date(until).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`,
  );
});

test("shows a new recovery key when remembering changed the vault's keys", async () => {
  await start((request) =>
    request.type === "vault-unlock"
      ? {
          status: { ...LOCKED, state: "unlocked", rememberedUntil: 1 },
          recoveryKey: "TkVX",
        }
      : LOCKED,
  );

  fill("#unlock-password", "correct horse");
  document.querySelector<HTMLInputElement>("#unlock-remember")!.checked = true;
  await submit("#unlock");

  expect($("#recovery").hidden).toBe(false);
  expect($("#recovery-key").textContent).toBe("TkVX");
  expect($("#recovery-note").textContent).toContain(
    "your old recovery key no longer works",
  );
});

test("forgets the device", async () => {
  await start((request) =>
    request.type === "device-forget"
      ? { ...LOCKED, state: "unlocked" }
      : { ...LOCKED, state: "unlocked", rememberedUntil: Date.now() },
  );
  expect($("#remembered").hidden).toBe(false);

  $("#forget-device").click();
  await settle();

  expect(sendMessage).toHaveBeenCalledWith({ type: "device-forget" });
  expect($("#remembered").hidden).toBe(true);
});
