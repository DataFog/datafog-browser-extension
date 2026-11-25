/**
 * The service worker opens the offscreen document and passes requests to it.
 */

import { beforeEach, expect, test, vi } from "vitest";

import {
  NO_CHAT_BOX,
  NO_CHAT_BOX_UPDATE,
  type OffscreenRequest,
  type PanelNotice,
  type PanelRequest,
  type Request,
  type TabRequest,
} from "./messages";
import { DEFAULT_SETTINGS } from "./settings";

/** Who a message came from, as Chrome reports it. */
interface Sender {
  tab?: { id?: number; windowId?: number };
  id?: string;
  url?: string;
}

type Listener = (
  request: Request | PanelRequest | PanelNotice,
  sender: Sender,
  respond: (response: unknown) => void,
) => boolean;

let listener: Listener;
let open: boolean;
const createDocument = vi.fn(async () => {
  open = true;
});
const sendMessage = vi.fn(
  async (_message: OffscreenRequest): Promise<unknown> => ({
    seq: 1,
    enabled: true,
    counts: { EMAIL: 1 },
  }),
);
let connect: (port: unknown) => void = () => {};
const setBadgeText = vi.fn(async () => {});
const setTitle = vi.fn(async () => {});
const openPanel = vi.fn(async (_options: { tabId: number }) => {});
const tabMessage = vi.fn(
  async (_tabId: number, _request: TabRequest): Promise<unknown> => ({}),
);
const setStorage = vi.fn(async (_items: object) => {});
const removeStorage = vi.fn(async (_keys: string) => {});
const queryTabs = vi.fn(
  async (_query: object): Promise<{ id: number; discarded?: boolean }[]> => [
    { id: 7 },
  ],
);
const requestUpdateCheck = vi.fn(async () => ({ status: "no_update" }));
let updateAvailable: (details: { version: string }) => void = () => {};
let installed: (details: { reason: string }) => void = () => {};
const executeScript = vi.fn(
  async (_injection: { target: { tabId: number } }): Promise<unknown[]> => [],
);
const getTab = vi.fn(async (id: number) => ({
  id,
  active: true,
  url: "https://chatgpt.com/c/test",
}));
const createTab = vi.fn(async (_properties: object) => ({}));
let stored: object;

const PANEL: Sender = {
  id: "datafog",
  url: "chrome-extension://datafog/panel.html",
};
const ROUTING = { recordId: "cmVj", namespace: "bnM=" };

/**
 * A content script's sender, on a page.
 *
 * @param url The page's address.
 * @returns The sender.
 */
function fromPage(url: string): Sender {
  return { tab: { id: 7, windowId: 3 }, url };
}

/**
 * Send a request to the service worker as a content script would.
 *
 * @param request The request.
 * @returns The service worker's response.
 */
function send(
  request: Request | PanelRequest,
  sender: Sender = { tab: { id: 7, windowId: 3 } },
): Promise<unknown> {
  return new Promise((resolve) => listener(request, sender, resolve));
}

/**
 * Connect a side panel, as an open panel would.
 *
 * @param windowId The panel's window.
 * @returns The stubbed port and a way to drop it.
 */
function connectPanel(windowId: number): {
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: () => void;
} {
  const postMessage = vi.fn();
  const dropped: (() => void)[] = [];
  connect({
    name: String(windowId),
    postMessage,
    onDisconnect: {
      addListener: (added: () => void) => dropped.push(added),
    },
  });
  return { postMessage, disconnect: () => dropped.forEach((drop) => drop()) };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  open = false;
  stored = {};
  Object.assign(globalThis, {
    chrome: {
      action: { setBadgeText, setTitle },
      offscreen: {
        Reason: { WORKERS: "WORKERS" },
        createDocument,
        hasDocument: vi.fn(async () => open),
      },
      runtime: {
        onConnect: {
          addListener: (added: typeof connect) => {
            connect = added;
          },
        },
        onMessage: {
          addListener: (added: Listener) => {
            listener = added;
          },
        },
        onUpdateAvailable: {
          addListener: (added: typeof updateAvailable) => {
            updateAvailable = added;
          },
        },
        onInstalled: {
          addListener: (added: typeof installed) => {
            installed = added;
          },
        },
        requestUpdateCheck,
        getManifest: () => ({
          version: "0.1.0",
          content_scripts: [{ matches: ["https://chatgpt.com/*"] }],
        }),
        sendMessage,
        id: "datafog",
        getURL: (path: string) => `chrome-extension://datafog/${path}`,
      },
      sidePanel: { open: openPanel, setPanelBehavior: vi.fn(async () => {}) },
      storage: {
        local: {
          get: vi.fn(async () => stored),
          set: setStorage,
          remove: removeStorage,
        },
      },
      scripting: { executeScript },
      tabs: {
        get: getTab,
        sendMessage: tabMessage,
        query: queryTabs,
        create: createTab,
      },
    },
  });
  await import("./background");
});

test("turns checking off only for the sites it's off for", async () => {
  stored = { settings: { off: ["claude.ai"] } };
  const request: Request = { type: "scan", seq: 1, text: "a@b.co" };

  await send(request, fromPage("https://claude.ai/new"));
  await send(request, fromPage("https://chatgpt.com/"));

  const enabled = sendMessage.mock.calls.map(([message]) => message.host);
  expect(enabled).toEqual(["claude.ai", "chatgpt.com"]);
});

test("forwards scans with the settings, opening one offscreen document", async () => {
  const request: Request = { type: "scan", seq: 1, text: "a@b.co" };

  const responses = await Promise.all([send(request), send(request)]);

  expect(createDocument).toHaveBeenCalledOnce();
  expect(sendMessage).toHaveBeenCalledWith({
    target: "offscreen",
    request: { ...request, tabId: 7 },
    settings: DEFAULT_SETTINGS,
    routing: null,
    host: undefined,
    legacySettings: undefined,
  });
  expect(responses[0]).toEqual({ seq: 1, enabled: true, counts: { EMAIL: 1 } });
});

test("sets the toolbar badge itself", async () => {
  expect(await send({ type: "protection", protected: false })).toEqual({
    updateReady: false,
  });

  expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "!" });
  expect(setTitle).toHaveBeenCalledWith({ tabId: 7, title: NO_CHAT_BOX });
  expect(requestUpdateCheck).toHaveBeenCalled();
  expect(createDocument).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
});

test("says an update may fix a missing chat box when one is waiting", async () => {
  stored = { pendingUpdate: "0.2.0" };

  expect(await send({ type: "protection", protected: false })).toEqual({
    updateReady: true,
  });
  expect(setTitle).toHaveBeenCalledWith({
    tabId: 7,
    title: NO_CHAT_BOX_UPDATE,
  });
  expect(requestUpdateCheck).not.toHaveBeenCalled();
});

test("ignores a saved update once it's the version running", async () => {
  stored = { pendingUpdate: "0.1.0" };

  expect(await send({ type: "update-status" }, PANEL)).toEqual({
    ready: false,
  });
});

test("saves a waiting update's version, and tells the side panel", async () => {
  updateAvailable({ version: "0.2.0" });

  expect(setStorage).toHaveBeenCalledWith({ pendingUpdate: "0.2.0" });
  expect(sendMessage).toHaveBeenCalledWith({
    target: "panel",
    type: "update-ready",
  });
});

test("answers the update status for the side panel only", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  stored = { pendingUpdate: "0.2.0" };

  expect(await send({ type: "update-status" })).toEqual({
    error: "not_allowed",
  });
  expect(await send({ type: "update-status" }, PANEL)).toEqual({
    ready: true,
  });
  warn.mockRestore();
});

test("answers and logs a code when the offscreen document fails", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  sendMessage.mockRejectedValueOnce(new Error("a@b.co"));

  expect(await send({ type: "redact", text: "a@b.co" })).toEqual({
    error: "datafog_failed",
  });
  expect(warn).toHaveBeenCalledWith("datafog redact failed: datafog_failed");
  expect(JSON.stringify(warn.mock.calls)).not.toContain("a@b.co");
  warn.mockRestore();
});

test("opens the side panel for the tab that asked", async () => {
  const pending = send({ type: "open-panel" });

  // Synchronously, before any await, so the click still counts as a gesture
  expect(openPanel).toHaveBeenCalledWith({ tabId: 7 });
  await pending;
  expect(createDocument).not.toHaveBeenCalled();
});

test("closes the side panel when it's already open in that window", async () => {
  const panel = connectPanel(3);

  await send({ type: "open-panel" });

  expect(panel.postMessage).toHaveBeenCalledWith("close");
  expect(openPanel).not.toHaveBeenCalled();
});

test("opens the side panel when only another window has one", async () => {
  const panel = connectPanel(4);

  await send({ type: "open-panel" });

  expect(panel.postMessage).not.toHaveBeenCalled();
  expect(openPanel).toHaveBeenCalledWith({ tabId: 7 });
});

test("opens the side panel again after it closes", async () => {
  connectPanel(3).disconnect();

  await send({ type: "open-panel" });

  expect(openPanel).toHaveBeenCalledWith({ tabId: 7 });
});

test("refuses vault requests from a web page", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  expect(await send({ type: "vault-delete" })).toEqual({
    error: "not_allowed",
  });
  expect(
    await send(
      { type: "vault-status" },
      { id: "datafog", url: "https://chatgpt.com/" },
    ),
  ).toEqual({ error: "not_allowed" });
  expect(sendMessage).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("forwards the side panel's requests with the vault's routing", async () => {
  stored = { vault: ROUTING };
  sendMessage.mockResolvedValueOnce({ state: "locked" });

  expect(await send({ type: "vault-status" }, PANEL)).toEqual({
    state: "locked",
  });
  expect(sendMessage).toHaveBeenCalledWith({
    target: "offscreen",
    request: { type: "vault-status" },
    settings: DEFAULT_SETTINGS,
    routing: ROUTING,
  });
});

test("passes not sensitive choices on from the side panel only", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const mark = { type: "review-not-sensitive", index: 0 } as const;
  const clear = {
    type: "choice-clear",
    entityType: "PERSON",
    value: "Ann",
  } as const;

  expect(await send(mark)).toEqual({ error: "not_allowed" });
  expect(await send(clear)).toEqual({ error: "not_allowed" });
  expect(sendMessage).not.toHaveBeenCalled();

  sendMessage.mockResolvedValue({ state: "unlocked" });
  await send(mark, PANEL);
  await send(clear, PANEL);
  const sent = sendMessage.mock.calls.map(([message]) => message.request);
  expect(sent).toEqual([mark, clear]);
  warn.mockRestore();
});

test("has every tab check again once a not sensitive choice changes", async () => {
  queryTabs.mockResolvedValue([{ id: 7 }, { id: 8 }]);
  sendMessage.mockResolvedValue({ state: "unlocked" });
  tabMessage.mockRejectedValueOnce(new Error("no content script"));

  await send({ type: "review-not-sensitive", index: 0 }, PANEL);
  await vi.waitFor(() =>
    expect(tabMessage).toHaveBeenCalledWith(8, { type: "recheck" }),
  );
  expect(tabMessage).toHaveBeenCalledWith(7, { type: "recheck" });

  tabMessage.mockClear();
  await send(
    { type: "choice-clear", entityType: "PERSON", value: "Ann" },
    PANEL,
  );
  await vi.waitFor(() => expect(tabMessage).toHaveBeenCalledTimes(2));
});

test("stores a new vault's routing, and passes on its status", async () => {
  sendMessage.mockResolvedValueOnce({
    status: { state: "unlocked" },
    routing: ROUTING,
  });

  expect(
    await send(
      { type: "vault-create", password: "correct horse", remember: false },
      PANEL,
    ),
  ).toEqual({ state: "unlocked" });
  expect(setStorage).toHaveBeenCalledWith({ vault: ROUTING });
});

test("forgets the vault's routing once it's deleted", async () => {
  sendMessage.mockResolvedValueOnce({
    result: { state: "none" },
    storage: { deleted: true },
  });

  expect(await send({ type: "vault-delete" }, PANEL)).toEqual({
    state: "none",
  });
  expect(removeStorage).toHaveBeenCalledWith([
    "vault",
    "settings",
    "vaultDeleting",
  ]);
});

test("lets the settings page, open in a tab, delete vault data", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  sendMessage.mockResolvedValueOnce({
    result: { state: "none" },
    storage: { deleted: true },
  });
  const settingsTab: Sender = {
    id: "datafog",
    tab: { id: 9, windowId: 3 },
    url: "chrome-extension://datafog/options.html",
  };

  expect(await send({ type: "vault-delete" }, settingsTab)).toEqual({
    state: "none",
  });
  // Another extension page in a tab, or a web page, still can't
  expect(
    await send(
      { type: "vault-delete" },
      { ...settingsTab, url: "chrome-extension://datafog/harness.html" },
    ),
  ).toEqual({ error: "not_allowed" });
  expect(
    await send({ type: "vault-delete" }, fromPage("https://chatgpt.com/")),
  ).toEqual({ error: "not_allowed" });
  warn.mockRestore();
});

test("keeps the routing when deleting fails", async () => {
  sendMessage.mockResolvedValueOnce({ error: "delete_failed" });

  expect(await send({ type: "vault-delete" }, PANEL)).toEqual({
    error: "delete_failed",
  });
  expect(removeStorage).not.toHaveBeenCalled();
});

test("replaces directly without opening the side panel", async () => {
  sendMessage.mockResolvedValueOnce({ state: "locked", waiting: true });

  const pending = send({ type: "pseudonymize", text: "a@b.co" });

  expect(openPanel).not.toHaveBeenCalled();
  await pending;
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      request: { type: "pseudonymize", text: "a@b.co", tabId: 7 },
    }),
  );
});

test("keeps an open side panel open for Pseudonymize", async () => {
  const panel = connectPanel(3);
  sendMessage.mockResolvedValueOnce({ state: "unlocked" });

  await send({ type: "pseudonymize", text: "a@b.co" });

  expect(openPanel).not.toHaveBeenCalled();
  expect(panel.postMessage).not.toHaveBeenCalled();
});

/**
 * Answer the offscreen document's vault requests during an approval.
 *
 * @param message The forwarded request.
 * @returns Its response.
 */
async function offscreenForApproval(
  message: OffscreenRequest,
): Promise<unknown> {
  switch (message.request.type) {
    case "review-source":
      return { source: { tabId: 7, text: "a@b.co" } };
    case "review-approve":
      return {
        tabId: 7,
        text: "a@b.co",
        response: { text: "[[EMAIL_7KQ4ZM]]", edits: [] },
      };
    default:
      return { state: "unlocked" };
  }
}

test("saves an approved review and has the tab apply it", async () => {
  sendMessage.mockImplementation(offscreenForApproval);
  tabMessage.mockImplementation(async (_tabId, request) =>
    request.type === "chat-text" ? { text: "a@b.co" } : {},
  );

  expect(await send({ type: "review-approve" }, PANEL)).toEqual({
    state: "unlocked",
  });
  expect(tabMessage).toHaveBeenLastCalledWith(7, {
    type: "apply-pseudonyms",
    before: "a@b.co",
    response: { text: "[[EMAIL_7KQ4ZM]]", edits: [] },
  });
});

test("saves one reviewed value, applies it, and reviews the values left", async () => {
  const marked = "a@b.co and [[EMAIL_7KQ4ZM]]";
  sendMessage.mockImplementation(async (message: OffscreenRequest) => {
    switch (message.request.type) {
      case "review-source":
        return { source: { tabId: 7, text: "a@b.co and c@d.co" } };
      case "review-mark-sensitive":
        return {
          tabId: 7,
          text: "a@b.co and c@d.co",
          response: {
            text: marked,
            edits: [{ start: 11, end: 17, replacement: "[[EMAIL_7KQ4ZM]]" }],
          },
          remaining: 1,
        };
      default:
        return { state: "unlocked" };
    }
  });
  let chatText = "a@b.co and c@d.co";
  tabMessage.mockImplementation(async (_tabId, request) => {
    if (request.type === "apply-pseudonyms") chatText = request.response.text;
    return request.type === "chat-text" ? { text: chatText } : {};
  });

  expect(
    await send({ type: "review-mark-sensitive", index: 1 }, PANEL),
  ).toEqual({ state: "unlocked" });
  const sent = sendMessage.mock.calls.map(([message]) => message.request);
  expect(sent).toContainEqual({ type: "review-mark-sensitive", index: 1 });
  expect(sent).toContainEqual({ type: "pseudonymize", text: marked, tabId: 7 });
});

test("refuses to mark a value sensitive for a web page", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await send({ type: "review-mark-sensitive", index: 0 })).toEqual({
    error: "not_allowed",
  });
  expect(sendMessage).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("drops the review when the chat box changed since", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  sendMessage.mockImplementation(offscreenForApproval);
  tabMessage.mockResolvedValue({ text: "a@b.co and more" });

  expect(await send({ type: "review-approve" }, PANEL)).toEqual({
    error: "chat_box_changed",
  });
  const sent = sendMessage.mock.calls.map(([message]) => message.request.type);
  expect(sent).toContain("review-cancel");
  expect(sent).not.toContain("review-approve");
  warn.mockRestore();
});

test("restores the latest answer, showing the values in the page", async () => {
  tabMessage
    .mockResolvedValueOnce({ text: "Hi [[EMAIL_7KQ4ZM]]" })
    .mockResolvedValueOnce({ shown: 1 });
  const values = [{ marker: "[[EMAIL_7KQ4ZM]]", original: "a@b.co" }];
  const restored = { text: "Hi a@b.co", restored: 1, unrestored: 0 };
  sendMessage.mockResolvedValueOnce({ ...restored, values });

  expect(await send({ type: "restore-latest", windowId: 3 }, PANEL)).toEqual({
    ...restored,
    shown: 1,
  });
  expect(queryTabs).toHaveBeenCalledWith({ active: true, windowId: 3 });
  expect(tabMessage).toHaveBeenCalledWith(7, { type: "latest-answer" });
  expect(tabMessage).toHaveBeenCalledWith(7, {
    type: "show-originals",
    values,
  });
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      request: { type: "restore", text: "Hi [[EMAIL_7KQ4ZM]]" },
    }),
  );
});

test("says when there's no chat or answer to restore", async () => {
  tabMessage.mockRejectedValueOnce(new Error("Receiving end does not exist"));
  expect(await send({ type: "restore-latest", windowId: 3 }, PANEL)).toEqual({
    error: "no_chat",
  });

  tabMessage.mockResolvedValueOnce({ text: null });
  expect(await send({ type: "restore-latest", windowId: 3 }, PANEL)).toEqual({
    error: "no_answer",
  });
});

test("refuses restore requests from a web page", async () => {
  expect(await send({ type: "restore-latest", windowId: 3 })).toEqual({
    error: "not_allowed",
  });
  expect(tabMessage).not.toHaveBeenCalled();
});

test("hides the values in the page when asked", async () => {
  expect(await send({ type: "hide-originals", windowId: 3 }, PANEL)).toEqual(
    {},
  );
  expect(tabMessage).toHaveBeenCalledWith(7, { type: "hide-originals" });
});

test("status notices do not trigger recursive access or page reveals", () => {
  listener({ target: "panel", type: "vault-changed" }, PANEL, () => {});
  expect(sendMessage).not.toHaveBeenCalled();
  expect(tabMessage).not.toHaveBeenCalled();
});

test("says when the latest answer has no markers", async () => {
  tabMessage.mockResolvedValueOnce({ text: "Nothing to restore" });
  sendMessage.mockResolvedValueOnce({
    text: "Nothing to restore",
    restored: 0,
    unrestored: 0,
    values: [],
  });

  expect(await send({ type: "restore-latest", windowId: 3 }, PANEL)).toEqual({
    error: "no_markers",
  });
  expect(tabMessage).not.toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "show-originals" }),
  );
});

test("removes legacy plaintext only after verified encrypted migration", async () => {
  stored = { settings: { allowlist: ["private@example.com"] } };
  sendMessage.mockResolvedValueOnce({
    result: DEFAULT_SETTINGS,
    storage: { routing: ROUTING, migrated: true },
  });
  await send({ type: "settings-get" });
  expect(setStorage).toHaveBeenCalledWith({ vault: ROUTING });
  expect(removeStorage).toHaveBeenCalledWith("settings");
});

test("failed migration keeps plaintext for retry and does not claim a clean scan", async () => {
  stored = { settings: { allowlist: ["private@example.com"] } };
  sendMessage.mockResolvedValueOnce({
    error: "preferences_verification_failed",
  });
  expect(
    await send({ type: "scan", text: "private@example.com", seq: 5 }),
  ).toEqual({ error: "preferences_verification_failed" });
  expect(removeStorage).not.toHaveBeenCalled();
});

test("partial deletion blocks access and permits explicit cleanup retry", async () => {
  stored = { vault: ROUTING, vaultDeleting: true };
  expect(await send({ type: "settings-get" })).toEqual({
    error: "vault_deletion_incomplete",
  });
  expect(sendMessage).not.toHaveBeenCalled();
  sendMessage.mockResolvedValueOnce({
    result: { state: "none" },
    storage: { deleted: true },
  });
  expect(await send({ type: "vault-delete" }, PANEL)).toEqual({
    state: "none",
  });
  expect(removeStorage).toHaveBeenCalledWith([
    "vault",
    "settings",
    "vaultDeleting",
  ]);
});

test("plaintext cleanup failure is reported and can safely be retried", async () => {
  stored = { settings: { allowlist: ["private@example.com"] } };
  sendMessage.mockResolvedValue({
    result: DEFAULT_SETTINGS,
    storage: { routing: ROUTING, migrated: true },
  });
  removeStorage.mockRejectedValueOnce(new Error("disk"));
  expect(await send({ type: "settings-get" })).toEqual({
    error: "datafog_failed",
  });
  expect(await send({ type: "settings-get" })).toEqual(DEFAULT_SETTINGS);
});

test("does not misreport a confirmed mapping save when bootstrap metadata fails", async () => {
  sendMessage.mockResolvedValueOnce({
    result: { text: "[[EMAIL_A]]", edits: [], saved: true },
    storage: { routing: ROUTING, migrated: true },
  });
  setStorage.mockRejectedValueOnce(new Error("disk"));
  expect(await send({ type: "pseudonymize", text: "a@b.co" })).toEqual({
    text: "[[EMAIL_A]]",
    edits: [],
    saved: true,
    warning: "metadata_cleanup_incomplete",
  });
  expect(openPanel).not.toHaveBeenCalled();
});

test("a new install reaches open chat tabs, then opens the welcome page", async () => {
  queryTabs.mockResolvedValueOnce([
    { id: 7 },
    { id: 8, discarded: true },
    { id: 9 },
  ]);
  executeScript.mockImplementation(async (injection) => {
    if (injection.target.tabId === 9)
      throw new Error("Cannot access contents of the page");
    return [];
  });

  installed({ reason: "install" });
  await vi.waitFor(() => expect(createTab).toHaveBeenCalled());

  expect(queryTabs).toHaveBeenCalledWith({ url: ["https://chatgpt.com/*"] });
  // A discarded tab gets the script when it next loads
  expect(executeScript).toHaveBeenCalledTimes(2);
  expect(executeScript).toHaveBeenCalledWith({
    target: { tabId: 7 },
    files: ["content.js"],
  });
  expect(setStorage).toHaveBeenCalledWith({ unreachedTabs: [9] });
  expect(createTab).toHaveBeenCalledWith({
    url: "chrome-extension://datafog/welcome.html",
  });
  executeScript.mockReset();
});

test("an update reaches open chat tabs but never reopens the welcome page", async () => {
  queryTabs.mockResolvedValueOnce([{ id: 7 }]);

  installed({ reason: "update" });
  await vi.waitFor(() =>
    expect(setStorage).toHaveBeenCalledWith({ unreachedTabs: [] }),
  );

  expect(executeScript).toHaveBeenCalledOnce();
  expect(createTab).not.toHaveBeenCalled();
});

test("the welcome page, open in a tab, may use the vault", async () => {
  sendMessage.mockResolvedValueOnce({ state: "unlocked" });
  const welcome: Sender = {
    id: "datafog",
    tab: { id: 9, windowId: 3 },
    url: "chrome-extension://datafog/welcome.html",
  };

  expect(await send({ type: "vault-status" }, welcome)).toEqual({
    state: "unlocked",
  });
});

test("forget is panel-only and refreshes revealed originals after success or uncertain failure", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const request = {
    type: "forget-original",
    marker: "[[EMAIL_123456]]",
  } as const;
  expect(await send(request)).toEqual({ error: "not_allowed" });
  expect(sendMessage).not.toHaveBeenCalled();
  queryTabs.mockResolvedValue([{ id: 7 }, { id: 8 }]);
  sendMessage.mockResolvedValueOnce({ result: { saved: true } });
  expect(await send(request, PANEL)).toEqual({ saved: true });
  expect(tabMessage).toHaveBeenCalledWith(7, { type: "recheck" });
  expect(tabMessage).toHaveBeenCalledWith(8, { type: "recheck" });
  tabMessage.mockClear();
  sendMessage.mockResolvedValueOnce({ error: "OutcomeUnknown" });
  expect(await send(request, PANEL)).toEqual({ error: "OutcomeUnknown" });
  expect(tabMessage).toHaveBeenCalledWith(7, { type: "recheck" });
  warn.mockRestore();
});

test("selection uses sender tab rather than a caller supplied reservation tab", async () => {
  sendMessage.mockResolvedValueOnce({ seq: 2 });
  await send({
    type: "select",
    text: "a@b.co",
    seq: 2,
    tabId: 99,
    previewId: "reserved",
    keep: [],
  });
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      request: {
        type: "select",
        text: "a@b.co",
        seq: 2,
        tabId: 7,
        previewId: "reserved",
        keep: [],
      },
    }),
  );
});

test("PDF apply checks the bound draft before forwarding an exact preview", async () => {
  const draft = {
    tabId: 7,
    url: "https://chatgpt.com/c/test",
    text: "draft",
    revision: 2,
    documentId: "doc",
  };
  const request = {
    type: "pdf-apply" as const,
    draft,
    previewId: "reserved",
    policyVersion: "policy",
  };
  sendMessage.mockResolvedValueOnce({
    result: {
      chunks: [{ id: "page", text: "[[EMAIL_ABC123]]", edits: [] }],
      saved: true,
    },
  });
  await send(request, PANEL);
  expect(tabMessage).toHaveBeenCalledWith(7, { type: "pdf-check", draft });
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ request }),
  );
  sendMessage.mockClear();
  tabMessage.mockResolvedValueOnce({ error: "pdf_draft_changed" });
  expect(await send(request, PANEL)).toEqual({ error: "pdf_draft_changed" });
  expect(sendMessage).not.toHaveBeenCalled();
});
