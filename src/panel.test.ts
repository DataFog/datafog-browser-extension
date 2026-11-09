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
  });
  expect($("#recovery").hidden).toBe(false);
  expect($("#recovery-key").textContent).toBe("S2V5");
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
      { original: "<b>jane@example.com</b>", marker: "[[EMAIL_7KQ4ZM]]" },
    ],
  }));

  expect($("#review").hidden).toBe(false);
  expect($("#approve").hidden).toBe(false);
  const item = document.querySelector("#review-items li")!;
  expect(item.querySelector("b")).toBeNull();
  expect(item.textContent).toContain("<b>jane@example.com</b>");
  expect(item.textContent).toContain("→ [[EMAIL_7KQ4ZM]]");
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
  const review = [{ original: "jane@example.com", marker: "[[EMAIL_7KQ4ZM]]" }];
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

test("resets the vault with its password", async () => {
  let status: VaultStatus = { ...LOCKED, state: "unlocked" };
  await start((request) => {
    if (request.type !== "vault-reset") return status;
    status = { ...LOCKED, state: "locked" };
    if (request.password !== "correct horse")
      return { error: "Authentication" };
    status = { ...LOCKED, state: "none" };
    return status;
  });

  $("#reset-open").click();
  expect($("#reset").hidden).toBe(false);
  expect($("#unlocked").hidden).toBe(true);

  fill("#reset-password", "wrong password");
  await submit("#reset");
  expect($("#vault-error").textContent).toBe("That password isn't right.");
  expect($("#reset").hidden).toBe(false);
  expect($("#unlock").hidden).toBe(true);

  fill("#reset-password", "correct horse");
  await submit("#reset");
  expect(sendMessage).toHaveBeenCalledWith({
    type: "vault-reset",
    password: "correct horse",
  });
  expect($("#reset").hidden).toBe(true);
  expect($("#create").hidden).toBe(false);
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
