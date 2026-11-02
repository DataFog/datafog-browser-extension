/**
 * Service worker: keeps the offscreen document open and passes the content
 * script's requests to it. Core runs there, since Chrome stops this worker
 * when idle.
 */

import { toError, type OffscreenRequest, type Request } from "./messages";
import { loadSettings } from "./settings";

let opening: Promise<void> | undefined;

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
 * @param tabId The sending tab, if any.
 * @returns The response to send back.
 */
async function handle(request: Request, tabId?: number): Promise<unknown> {
  if (request.type === "open-panel") {
    // Called before any await, so Chrome still sees the user's click
    if (tabId !== undefined) await chrome.sidePanel.open({ tabId });
    return {};
  }
  if (request.type === "protection") {
    // Toolbar "!" when the chat box can't be found (the page isn't protected)
    await chrome.action.setBadgeText({
      tabId,
      text: request.protected ? "" : "!",
    });
    return {};
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
  handle(request, sender.tab?.id).then(respond, (error) =>
    respond(toError(error)),
  );
  return true;
});

// The toolbar icon opens the side panel; settings are linked from there
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
