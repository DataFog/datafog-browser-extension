/**
 * Service worker: runs DataFog Core and answers the content script.
 */

import { countFindings, ready, redact } from "./detect";
import type { ErrorResponse, Request } from "./messages";
import { loadSettings } from "./settings";

// Start loading Core right away; requests wait on it
const engine = ready();

/**
 * Handle one request from a content script.
 *
 * @param request The request.
 * @param tabId The sending tab, if any.
 * @returns The response to send back.
 */
async function handle(request: Request, tabId?: number): Promise<unknown> {
  if (request.type === "protection") {
    // Toolbar "!" when the chat box can't be found (the page isn't protected)
    await chrome.action.setBadgeText({
      tabId,
      text: request.protected ? "" : "!",
    });
    return {};
  }

  await engine;
  const settings = await loadSettings();

  if (request.type === "scan") {
    return {
      seq: request.seq,
      enabled: settings.enabled,
      counts: settings.enabled ? countFindings(request.text, settings) : {},
    };
  }
  return { text: redact(request.text, settings) };
}

/**
 * Reduce a failure to a code, so prompt text never lands in a log.
 *
 * @param error What was thrown.
 * @returns An error response.
 */
function toError(error: unknown): ErrorResponse {
  const code = (error as { code?: unknown } | null)?.code;
  return { error: typeof code === "string" ? code : "datafog_failed" };
}

// Registered synchronously, as Manifest V3 requires
chrome.runtime.onMessage.addListener((request: Request, sender, respond) => {
  handle(request, sender.tab?.id).then(respond, (error) =>
    respond(toError(error)),
  );
  return true;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
