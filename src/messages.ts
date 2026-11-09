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
  | { type: "pseudonymize"; text: string }
  | { type: "protection"; protected: boolean }
  | { type: "open-panel" }
  | { type: "block-sends" };

/** A content script request that needs Core. */
export type CoreRequest = Exclude<
  Request,
  | { type: "pseudonymize" }
  | { type: "protection" }
  | { type: "open-panel" }
  | { type: "block-sends" }
>;

/**
 * A side panel request. Only extension pages may send these: they carry the
 * password, and the review shows the original values.
 */
export type PanelRequest =
  | { type: "vault-status" }
  | { type: "vault-create"; password: string }
  | { type: "vault-unlock"; password: string }
  | { type: "vault-lock" }
  | { type: "vault-reset"; password: string }
  | { type: "review-approve" }
  | { type: "review-cancel" }
  | { type: "restore-latest"; windowId: number };

/** A vault request the service worker forwards to the offscreen document. */
export type VaultRequest =
  | Exclude<PanelRequest, { type: "review-approve" | "restore-latest" }>
  | { type: "restore"; text: string }
  | { type: "pseudonymize"; text: string; tabId: number }
  | { type: "review-source" }
  | { type: "review-approve" };

/**
 * A request the service worker forwards to the offscreen document. Offscreen
 * documents can't read chrome.storage, so the settings and the vault's
 * routing travel with it.
 */
export interface OffscreenRequest {
  target: "offscreen";
  request: CoreRequest | VaultRequest;
  settings: Settings;
  routing?: VaultRouting | null;
}

/** A request the service worker sends a ChatGPT tab. */
export type TabRequest =
  | { type: "chat-text" }
  | { type: "latest-answer" }
  | { type: "apply-pseudonyms"; before: string; response: RedactResponse };

/** Tells an open side panel the vault or its review changed. */
export interface PanelNotice {
  target: "panel";
  type: "vault-changed";
}

/**
 * Where the workspace lives in the vault: public identifiers, base64, kept in
 * chrome.storage.local so the vault can be reopened.
 */
export interface VaultRouting {
  recordId: string;
  namespace: string;
}

export type VaultState = "none" | "locked" | "unlocked";

/** One value a review would replace, shown only in the side panel. */
export interface ReviewItem {
  original: string;
  marker: string;
}

export interface VaultStatus {
  state: VaultState;
  /** Pseudonymize was asked for while locked; unlocking prepares it. */
  waiting: boolean;
  review: ReviewItem[] | null;
  /**
   * Why the last Pseudonymize couldn't be prepared or saved. Not named error,
   * which marks a failed response.
   */
  reviewError: string | null;
}

export interface CreatedVault {
  status: VaultStatus;
  /** Shown once; the vault keeps no copy it can show again. */
  recoveryKey: string;
  routing: VaultRouting;
}

/** The text a review was prepared from, and its tab. */
/** An answer with its markers restored, and how many were and weren't. */
export interface Restored {
  text: string;
  restored: number;
  unrestored: number;
}

export interface ReviewSource {
  tabId: number;
  text: string;
}

/** A saved Pseudonymize, ready to apply to its tab's chat box. */
export interface Pseudonymized extends ReviewSource {
  response: RedactResponse;
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
