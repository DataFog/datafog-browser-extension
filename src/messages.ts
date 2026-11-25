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
  "datafog can't find the chat box, so this page isn't being checked. Try reloading it.";

/** The same, when a DataFog update is waiting that may fix it. */
export const NO_CHAT_BOX_UPDATE =
  "datafog can't find the chat box, so this page isn't being checked. A datafog update is ready and may fix this: open datafog and choose Update now.";

export type Request =
  | {
      type: "scan";
      seq: number;
      text: string;
      tabId?: number;
      keep?: KeepPlace[];
      redact?: KeepPlace[];
    }
  | {
      type: "select";
      seq: number;
      text: string;
      tabId?: number;
      previewId: string;
      keep: KeepPlace[];
      redact?: KeepPlace[];
    }
  | { type: "redact"; text: string; keep?: KeepPlace[] }
  | { type: "pseudonymize"; text: string; previewId?: string }
  | { type: "apply"; text: string; previewId: string }
  | { type: "protection"; protected: boolean }
  | { type: "open-panel" }
  | { type: "block-sends" }
  | { type: "restore"; text: string }
  | { type: "always-allow"; entityType: string; value: string }
  | { type: "settings-get" }
  | { type: "settings-save"; settings: Settings };

/** A content script request that needs Core. */
export type CoreRequest = Exclude<
  Request,
  | { type: "pseudonymize" }
  | { type: "apply" }
  | { type: "protection" }
  | { type: "open-panel" }
  | { type: "block-sends" }
  | { type: "restore" }
  | { type: "always-allow" }
  | { type: "settings-get" }
  | { type: "settings-save" }
>;

/**
 * A side panel request. Only extension pages may send these: they carry the
 * password, and the review shows the original values.
 */
export interface PdfDraft {
  tabId: number;
  url: string;
  text: string;
  revision: number;
  documentId: string;
}
export interface PdfFinding extends KeepPlace {
  entityType: string;
  original: string;
  action: "replace" | "redact" | "keep";
}
export interface PdfPreviewChunk {
  id: string;
  text: string;
  findings: PdfFinding[];
  policyVersion: string;
}
export interface PdfPreviewResponse {
  previewId: string;
  policyVersion: string;
  chunks: { id: string; text: string; edits: RedactEdit[] }[];
}
export type PdfRequest =
  | { type: "pdf-preview"; draft: PdfDraft; chunks: PdfPreviewChunk[] }
  | {
      type: "pdf-apply";
      draft: PdfDraft;
      previewId: string;
      policyVersion: string;
    }
  | { type: "pdf-preview-cancel"; previewId: string }
  | { type: "pdf-target"; windowId: number }
  | { type: "pdf-check-target"; draft: PdfDraft }
  | { type: "pdf-scan"; text: string; draft: PdfDraft }
  | {
      type: "pdf-commit";
      text: string;
      draft: PdfDraft;
      findings: PdfFinding[];
      policyVersion: string;
    }
  | { type: "pdf-insert"; draft: PdfDraft; text: string };

export type PanelRequest =
  | PdfRequest
  /** autoUnlock: the panel just opened, so a remembered device may unlock. */
  | { type: "vault-status"; autoUnlock?: boolean }
  | { type: "update-status" }
  | { type: "vault-create"; password: string; remember: boolean }
  | { type: "vault-lock" }
  | { type: "device-forget" }
  | { type: "vault-delete" }
  | { type: "forget-original"; marker: string }
  | { type: "review-approve" }
  | { type: "review-cancel" }
  /** Pseudonymize only the review's value at this index. */
  | { type: "review-mark-sensitive"; index: number }
  /** Remember the review's value at this index as not sensitive. */
  | { type: "review-not-sensitive"; index: number }
  /** Replace a value remembered as not sensitive again. */
  | { type: "choice-clear"; entityType: string; value: string }
  | { type: "restore-latest"; windowId: number }
  | { type: "hide-originals"; windowId: number };

/** A vault request the service worker forwards to the offscreen document. */
export type VaultRequest =
  | Exclude<
      PanelRequest,
      {
        type:
          | "review-approve"
          | "review-mark-sensitive"
          | "restore-latest"
          | "hide-originals";
      }
    >
  | { type: "restore"; text: string }
  | { type: "pseudonymize"; text: string; tabId: number; previewId?: string }
  | { type: "apply"; text: string; tabId: number; previewId: string }
  | { type: "always-allow"; entityType: string; value: string }
  | { type: "settings-get" }
  | { type: "settings-save"; settings: Settings }
  | { type: "review-source" }
  | { type: "review-approve" }
  | { type: "review-mark-sensitive"; index: number };

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
  legacySettings?: Partial<Settings>;
  host?: string;
}

/** A request the service worker sends a chat tab. */
export type TabRequest =
  | { type: "pdf-draft" }
  | { type: "pdf-check"; draft: PdfDraft }
  | { type: "pdf-insert-approved"; draft: PdfDraft; text: string }
  | { type: "chat-text" }
  | { type: "latest-answer" }
  | { type: "show-originals"; values: RestoredValue[] }
  | { type: "hide-originals" }
  /** Values marked not sensitive changed; check the chat box again. */
  | { type: "recheck"; policyVersion?: string }
  | { type: "apply-pseudonyms"; before: string; response: RedactResponse };

/** Tells an open side panel the vault or its review changed. */
export interface PanelNotice {
  target: "panel";
  type: "vault-changed" | "update-ready";
}

/**
 * Where the workspace lives in the vault: public identifiers, base64, kept in
 * chrome.storage.local so the vault can be reopened.
 */
export interface VaultRouting {
  /** New automatic-only stores have no user-held recovery password. */
  automatic?: boolean;
  /** Once set, missing preference ciphertext is corruption, never defaults. */
  preferences?: 1;
  recordId: string;
  namespace: string;
}

export type VaultState = "none" | "locked" | "unlocked";

/** One value a review would replace, shown only in the side panel. */
export interface KeepPlace {
  start: number;
  end: number;
}

export interface ReviewItem {
  action?: "replace" | "redact" | "keep";
  start?: number;
  end?: number;
  kept?: boolean;
  entityType: string;
  original: string;
  marker: string;
}

/** A value the user marked not sensitive; Core leaves it as is. */
export interface ValueChoice {
  entityType: string;
  value: string;
}

export interface VaultStatus {
  state: VaultState;
  access?: "ready" | "unavailable";
  commit?:
    "idle" | "saving" | "confirmed" | "uncertain" | "reconciling" | "failed";
  deletion?: "idle" | "deleting" | "complete" | "partial-failure";
  originals?: ReviewItem[];
  policyVersion?: string;
  /** Pseudonymize was asked for while locked; unlocking prepares it. */
  waiting: boolean;
  review: ReviewItem[] | null;
  /**
   * Why the last Pseudonymize couldn't be prepared or saved. Not named error,
   * which marks a failed response.
   */
  reviewError: string | null;
  /** When this device stops unlocking the vault, or null if not remembered. */
  rememberedUntil: number | null;
  /** Values marked not sensitive; empty while locked. */
  notSensitive: ValueChoice[];
}

export interface CreatedVault {
  status: VaultStatus;
  routing: VaultRouting;
}

/** The text a review was prepared from, and its tab. */
/** A marker and the original value it stands for. */
export interface RestoredValue {
  marker: string;
  original: string;
}

/** An answer with its markers restored, and how many were and weren't. */
export interface Restored {
  text: string;
  restored: number;
  unrestored: number;
}

/** What the vault restored, with each marker's value to show in the page. */
export interface RestoredWithValues extends Restored {
  values: RestoredValue[];
}

/** A restored answer, and how many values now show in the page. */
export interface RestoredInPage extends Restored {
  shown: number;
}

export interface ReviewSource {
  tabId: number;
  text: string;
}

/** A saved Pseudonymize, ready to apply to its tab's chat box. */
export interface Pseudonymized extends ReviewSource {
  response: RedactResponse;
}

/** One value pseudonymized from a review, and how many the review had left. */
export interface MarkedSensitive extends Pseudonymized {
  remaining: number;
}

export interface ScanResponse {
  seq: number;
  policyVersion?: string;
  findings?: ReviewItem[];
  previewId?: string;
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

export interface ApplyResponse extends RedactResponse {
  applied: true;
  replaced: number;
  redacted: number;
  saved: boolean;
  warning?: string;
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
