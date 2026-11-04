/**
 * Messages between the content script, the service worker and the offscreen
 * document.
 *
 * Prompt text only travels inside the extension; nothing is sent over the
 * network.
 */

import type { Settings } from "./settings";

/** Why a page isn't being checked, shown on the toolbar icon and page tab. */
export const NO_CHAT_BOX =
  "DataFog can't find the chat box, so this page isn't being checked. Try reloading it.";

export type Request =
  | { type: "scan"; seq: number; text: string }
  | { type: "redact"; text: string }
  | { type: "protection"; protected: boolean }
  | { type: "open-panel" }
  | { type: "block-sends" };

/** A content script request that needs Core. */
export type CoreRequest = Exclude<
  Request,
  { type: "protection" } | { type: "open-panel" } | { type: "block-sends" }
>;

/**
 * A request the service worker forwards to the offscreen document. Offscreen
 * documents can't read chrome.storage, so the settings travel with it.
 */
export interface OffscreenRequest {
  target: "offscreen";
  request: CoreRequest;
  settings: Settings;
}

export interface ScanResponse {
  seq: number;
  enabled: boolean;
  counts: Record<string, number>;
  blockSends: boolean;
}

export interface BlockSendsResponse {
  blockSends: boolean;
}

/** One redaction: a range of the original text and the label replacing it. */
export interface RedactEdit {
  /** UTF-16 offsets, as JavaScript strings index. */
  start: number;
  end: number;
  replacement: string;
}

export interface RedactResponse {
  text: string;
  edits: RedactEdit[];
}

/** Errors carry a code only, never prompt text. */
export interface ErrorResponse {
  error: string;
}

/**
 * Reduce a failure to a code, so prompt text never lands in a log.
 *
 * @param error What was thrown.
 * @returns An error response.
 */
export function toError(error: unknown): ErrorResponse {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  return { error: typeof code === "string" ? code : "datafog_failed" };
}
