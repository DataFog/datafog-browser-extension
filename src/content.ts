/**
 * Content script on chatgpt.com: watches the chat box as the user types.
 *
 * Never touches the send button. Redact edits the chat box; Dismiss hides the
 * warning, and the user sends with ChatGPT's own button.
 */

import { Badge } from "./badge";
import type {
  ErrorResponse,
  RedactResponse,
  Request,
  ScanResponse,
} from "./messages";

/** Idle time after the last keystroke before scanning. */
const DEBOUNCE_MS = 400;

/** How long to look for the chat box before warning it can't be found. */
const FIND_TIMEOUT_MS = 10_000;

const COMPOSER_SELECTORS = [
  "#prompt-textarea",
  "form [contenteditable='true']",
  "form textarea",
];

let composer: HTMLElement | null = null;
let timer: number | undefined;
let seq = 0;
let lastScanned = "";
let dismissedText: string | null = null;

const badge = new Badge(redactComposer, dismiss);

/**
 * Find the chat box.
 *
 * @returns The chat box element, or null if it isn't on the page.
 */
function findComposer(): HTMLElement | null {
  for (const selector of COMPOSER_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
  }
  return null;
}

/**
 * Read the chat box's text.
 *
 * @param element The chat box.
 * @returns Its current text.
 */
function readText(element: HTMLElement): string {
  return element instanceof HTMLTextAreaElement
    ? element.value
    : element.innerText;
}

/**
 * Send a request to the service worker.
 *
 * @param request The request.
 * @returns The response, or null if the extension was reloaded.
 */
async function ask<T extends object>(request: Request): Promise<T | null> {
  try {
    const response = await chrome.runtime.sendMessage<
      Request,
      T | ErrorResponse | undefined
    >(request);
    return response && !("error" in response) ? response : null;
  } catch {
    // The extension was reloaded under this page; the old script is orphaned
    return null;
  }
}

/**
 * Scan the chat box now.
 *
 * @param force Scan even if the text is unchanged.
 */
async function scanNow(force = false): Promise<void> {
  if (!composer) return;
  const text = readText(composer);
  if (!force && text === lastScanned) return;
  lastScanned = text;

  if (!text.trim()) {
    badge.show({ kind: "idle" });
    return;
  }

  // Drop answers to older requests: only the latest text counts
  const mine = ++seq;
  badge.show({ kind: "checking" });
  const response = await ask<ScanResponse>({ type: "scan", seq: mine, text });
  if (mine !== seq) return;
  if (!response) {
    badge.show({ kind: "failed" });
    return;
  }

  const found = Object.keys(response.counts).length > 0;
  if (!response.enabled) badge.show({ kind: "hidden" });
  // A dismissed warning falls back to the plain logo until the text changes
  else if (text === dismissedText) badge.show({ kind: "idle" });
  else
    badge.show(
      found ? { kind: "found", counts: response.counts } : { kind: "clean" },
    );
}

/**
 * Scan after the user pauses typing.
 *
 * @param delay Milliseconds to wait; 0 scans on the next tick.
 */
function schedule(delay: number): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void scanNow(), delay);
}

/**
 * Replace the chat box's contents through real edits, so the editor keeps them.
 *
 * Setting innerText directly is undone by ChatGPT's editor. Each line is
 * inserted as typed text, with a paragraph break between lines.
 *
 * @param element The chat box.
 * @param text The new contents.
 */
function replaceText(element: HTMLElement, text: string): void {
  element.focus();

  if (element instanceof HTMLTextAreaElement) {
    // The native setter, bypassing any the page's framework put on the element
    Reflect.set(HTMLTextAreaElement.prototype, "value", text, element);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  document.execCommand("selectAll");
  text.split("\n").forEach((part, index) => {
    if (index > 0) document.execCommand("insertParagraph");
    if (part) document.execCommand("insertText", false, part);
  });
}

/** Redact the chat box's sensitive values in place. */
async function redactComposer(): Promise<void> {
  if (!composer) return;
  const response = await ask<RedactResponse>({
    type: "redact",
    text: readText(composer),
  });
  if (!response) {
    badge.show({ kind: "failed" });
    return;
  }

  replaceText(composer, response.text);
  dismissedText = null;
  await scanNow(true);
}

/** Clear the warning until the text changes. */
function dismiss(): void {
  if (!composer) return;
  dismissedText = readText(composer);
  badge.show({ kind: "idle" });
}

/**
 * Start watching a chat box.
 *
 * @param element The chat box.
 */
function bind(element: HTMLElement): void {
  composer = element;
  lastScanned = "";
  badge.attach(element);
  element.addEventListener("input", () => schedule(DEBOUNCE_MS));
  // Pasted text lands after the event; scan on the next tick, not after a pause
  element.addEventListener("paste", () => schedule(0));
  void ask({ type: "protection", protected: true });
  void scanNow(true);
}

// ChatGPT re-renders the chat box when switching conversations
new MutationObserver(() => {
  const element = findComposer();
  if (element && element !== composer) bind(element);
}).observe(document.documentElement, { childList: true, subtree: true });

const initial = findComposer();
if (initial) bind(initial);

window.setTimeout(() => {
  if (!composer) void ask({ type: "protection", protected: false });
}, FIND_TIMEOUT_MS);
