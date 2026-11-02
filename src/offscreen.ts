/**
 * Offscreen document: runs DataFog Core, so it stays loaded while the side
 * panel is closed and the service worker is stopped.
 */

import { countFindings, ready, redact } from "./detect";
import { toError, type OffscreenRequest, type Request } from "./messages";

// Start loading Core right away; requests wait on it
const engine = ready();

/**
 * Answer one request forwarded by the service worker.
 *
 * @param message The forwarded request and the settings to use.
 * @returns The response to send back.
 */
async function handle({
  request,
  settings,
}: OffscreenRequest): Promise<unknown> {
  await engine;
  if (request.type === "scan") {
    return {
      seq: request.seq,
      enabled: settings.enabled,
      counts: settings.enabled ? countFindings(request.text, settings) : {},
    };
  }
  return { text: redact(request.text, settings) };
}

// Content script messages reach every extension page; answer forwarded ones only
chrome.runtime.onMessage.addListener(
  (message: OffscreenRequest | Request, _sender, respond) => {
    if (!("target" in message) || message.target !== "offscreen") return false;
    handle(message).then(respond, (error) => respond(toError(error)));
    return true;
  },
);
