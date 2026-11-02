/**
 * Messages between the content script and the service worker.
 *
 * Prompt text only travels inside the extension; nothing is sent over the
 * network.
 */

export type Request =
  | { type: "scan"; seq: number; text: string }
  | { type: "redact"; text: string }
  | { type: "protection"; protected: boolean };

export interface ScanResponse {
  seq: number;
  enabled: boolean;
  counts: Record<string, number>;
}

export interface RedactResponse {
  text: string;
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
