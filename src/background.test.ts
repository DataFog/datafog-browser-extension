/**
 * The service worker opens the offscreen document and passes requests to it.
 */

import { beforeEach, expect, test, vi } from "vitest";

import type { OffscreenRequest, Request } from "./messages";
import { DEFAULT_SETTINGS } from "./settings";

type Listener = (
  request: Request,
  sender: { tab?: { id?: number } },
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
const setBadgeText = vi.fn(async () => {});
const openPanel = vi.fn(async (_options: { tabId: number }) => {});

/**
 * Send a request to the service worker as a content script would.
 *
 * @param request The request.
 * @returns The service worker's response.
 */
function send(request: Request): Promise<unknown> {
  return new Promise((resolve) =>
    listener(request, { tab: { id: 7 } }, resolve),
  );
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  open = false;
  Object.assign(globalThis, {
    chrome: {
      action: { setBadgeText },
      offscreen: {
        Reason: { WORKERS: "WORKERS" },
        createDocument,
        hasDocument: vi.fn(async () => open),
      },
      runtime: {
        onMessage: {
          addListener: (added: Listener) => {
            listener = added;
          },
        },
        sendMessage,
      },
      sidePanel: { open: openPanel, setPanelBehavior: vi.fn(async () => {}) },
      storage: { local: { get: vi.fn(async () => ({})) } },
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
  expect(createDocument).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
});

test("answers a code when the offscreen document fails", async () => {
  sendMessage.mockRejectedValueOnce(
    new Error("Could not establish connection"),
  );

  expect(await send({ type: "redact", text: "a@b.co" })).toEqual({
    error: "datafog_failed",
  });
});

test("opens the side panel for the tab that asked", async () => {
  const pending = send({ type: "open-panel" });

  // Synchronously, before any await, so the click still counts as a gesture
  expect(openPanel).toHaveBeenCalledWith({ tabId: 7 });
  await pending;
  expect(createDocument).not.toHaveBeenCalled();
});
