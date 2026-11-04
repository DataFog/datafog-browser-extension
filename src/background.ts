/**
 * Service worker: keeps the offscreen document open and passes the content
 * script's requests to it. Core runs there, since Chrome stops this worker
 * when idle.
 */

import {
  NO_CHAT_BOX,
  toError,
  type OffscreenRequest,
  type Request,
} from "./messages";
import { blockingSends, loadSettings } from "./settings";

let opening: Promise<void> | undefined;

/** Each open side panel's connection, by window. */
const panels = new Map<number, chrome.runtime.Port>();

/**
 * Open the offscreen document unless it's already open.
 *
 * @returns Resolves once the document is ready for messages.
 */
async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  // Concurrent requests share one creation; Chrome allows only one document
  opening ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Runs DataFog Core and the FogVault Worker.",
    })
    .finally(() => {
      opening = undefined;
    });
  await opening;
}

/**
 * Handle one request from a content script.
 *
 * @param request The request.
 * @param tab The sending tab, if any.
 * @returns The response to send back.
 */
async function handle(
  request: Request,
  tab?: chrome.tabs.Tab,
): Promise<unknown> {
  const tabId = tab?.id;
  if (request.type === "open-panel") {
    const panel = tab && panels.get(tab.windowId);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a port, not a window
    if (panel) panel.postMessage("close");
    // Called before any await, so Chrome still sees the user's click
    else if (tabId !== undefined) await chrome.sidePanel.open({ tabId });
    return {};
  }
  if (request.type === "protection") {
    // Toolbar "!" when the chat box can't be found (the page isn't protected)
    await chrome.action.setBadgeText({
      tabId,
      text: request.protected ? "" : "!",
    });
    await chrome.action.setTitle({
      tabId,
      title: request.protected ? "Open DataFog" : NO_CHAT_BOX,
    });
    return {};
  }

  if (request.type === "block-sends") {
    return { blockSends: blockingSends(await loadSettings()) };
  }

  await ensureOffscreen();
  const forwarded: OffscreenRequest = {
    target: "offscreen",
    request,
    settings: await loadSettings(),
  };
  return chrome.runtime.sendMessage(forwarded);
}

// Registered synchronously, as Manifest V3 requires
chrome.runtime.onMessage.addListener((request: Request, sender, respond) => {
  handle(request, sender.tab).then(respond, (error) => {
    const response = toError(error);
    // The code only: an error's message can quote prompt text
    console.warn(`DataFog ${request.type} failed: ${response.error}`);
    respond(response);
  });
  return true;
});

// A panel connects when it opens, naming its window, and drops when it closes
chrome.runtime.onConnect.addListener((port) => {
  const windowId = Number(port.name);
  panels.set(windowId, port);
  port.onDisconnect.addListener(() => panels.delete(windowId));
});

// The toolbar icon opens the side panel; settings are linked from there
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
