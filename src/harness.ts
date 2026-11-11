/**
 * Local test page: runs the real content script and detection on a mock chat
 * box, with no extension APIs and no ChatGPT login.
 *
 * Stands in for chrome.runtime by calling the detection code directly.
 */

import { countFindings, ready, redact, scanRules } from "./detect";
import type { Request } from "./messages";
import { DEFAULT_SETTINGS } from "./settings";

const engine = ready();

/**
 * Answer a content-script request the way the service worker would.
 *
 * @param request The request.
 * @returns The response.
 */
async function sendMessage(request: Request): Promise<unknown> {
  await engine;
  if (request.type === "scan") {
    return {
      seq: request.seq,
      enabled: true,
      counts: await countFindings(request.text, DEFAULT_SETTINGS, scanRules),
    };
  }
  if (request.type === "redact") {
    return redact(request.text, DEFAULT_SETTINGS, scanRules);
  }
  return {};
}

Object.assign(globalThis, { chrome: { runtime: { sendMessage } } });

// Imported after the stub exists: the content script starts running on import
await import("./content");
