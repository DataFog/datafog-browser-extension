/**
 * The service worker opens the offscreen document and passes requests to it.
 */

import { beforeEach, expect, test, vi } from "vitest";

import {
  NO_CHAT_BOX,
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
const queryTabs = vi.fn(async (_query: object) => [{ id: 7 }]);
let stored: object;

const PANEL: Sender = {
  id: "datafog",
  url: "chrome-extension://datafog/panel.html",
};
const ROUTING = { recordId: "cmVj", namespace: "bnM=" };

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
      tabs: { sendMessage: tabMessage, query: queryTabs },
    },
  });
  await import("./background");
});

test("forwards scans with the settings, opening one offscreen document", async () => {
  const request: Request = { type: "scan", seq: 1, text: "a@b.co" };

  const responses = await Promise.all([send(request), send(request)]);

  expect(createDocument).toHaveBeenCalledOnce();
  expect(sendMessage).toHaveBeenCalledWith({
    target: "offscreen",
    request,
    settings: DEFAULT_SETTINGS,
  });
  expect(responses[0]).toEqual({ seq: 1, enabled: true, counts: { EMAIL: 1 } });
});

test("sets the toolbar badge itself", async () => {
  await send({ type: "protection", protected: false });

  expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "!" });
  expect(setTitle).toHaveBeenCalledWith({ tabId: 7, title: NO_CHAT_BOX });
  expect(createDocument).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
});

test("answers and logs a code when the offscreen document fails", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  sendMessage.mockRejectedValueOnce(new Error("a@b.co"));

  expect(await send({ type: "redact", text: "a@b.co" })).toEqual({
    error: "datafog_failed",
  });
  expect(warn).toHaveBeenCalledWith("DataFog redact failed: datafog_failed");
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

  expect(
    await send({ type: "vault-unlock", password: "pw", remember: false }),
  ).toEqual({
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

test("forgets the vault's routing once it's reset", async () => {
  sendMessage.mockResolvedValueOnce({ state: "none" });

  expect(await send({ type: "vault-reset" }, PANEL)).toEqual({ state: "none" });
  expect(removeStorage).toHaveBeenCalledWith("vault");
});

test("keeps the routing when a reset fails", async () => {
  sendMessage.mockResolvedValueOnce({ error: "reset_failed" });

  expect(await send({ type: "vault-reset" }, PANEL)).toEqual({
    error: "reset_failed",
  });
  expect(removeStorage).not.toHaveBeenCalled();
});

test("opens the side panel for Pseudonymize, within the click", async () => {
  sendMessage.mockResolvedValueOnce({ state: "locked", waiting: true });

  const pending = send({ type: "pseudonymize", text: "a@b.co" });

  expect(openPanel).toHaveBeenCalledWith({ tabId: 7 });
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

test("hides the values in every tab once the vault locks", async () => {
  queryTabs.mockResolvedValueOnce([{ id: 7 }, { id: 8 }]);
  sendMessage.mockResolvedValueOnce({ state: "locked" });
  tabMessage.mockRejectedValueOnce(new Error("no content script"));

  // The vault's notice gets no reply; the worker acts on it in the background
  listener({ target: "panel", type: "vault-changed" }, PANEL, () => {});
  await vi.waitFor(() =>
    expect(tabMessage).toHaveBeenCalledWith(8, { type: "hide-originals" }),
  );
  expect(tabMessage).toHaveBeenCalledWith(7, { type: "hide-originals" });
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
