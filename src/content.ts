/**
 * Content script on each chat site: watches the chat box as the user types.
 *
 * Redact and Pseudonymize edit the chat box; Dismiss hides the warning, and the
 * user sends with ChatGPT's own button. Pseudonymize is reviewed in the side
 * panel, and its markers come back from the service worker once approved.
 */

import { Badge } from "./badge";
import {
  NO_CHAT_BOX,
  NO_CHAT_BOX_UPDATE,
  type BlockSendsResponse,
  type ErrorResponse,
  type RedactResponse,
  type Request,
  type ScanResponse,
  type TabRequest,
} from "./messages";
import { hideOriginals, MARKER, showOriginals } from "./originals";
import { clickSend, watchPage } from "./page";
import { loadSettings } from "./settings";
import { siteFor } from "./site";
import { mountTab } from "./tab";
import { PENDING_UPDATE } from "./update";

/** The last redaction or pseudonymization, kept so it can be undone and redone. */
interface Redaction {
  /** The chat box's text without, and with, the redaction. */
  before: string;
  after: string;
  /** The edits from one text to the other. */
  redact: RedactResponse;
  restore: RedactResponse;
}

/** Idle time after the last keystroke before scanning. */
const DEBOUNCE_MS = 400;

/** How long to hold a send for a scan before treating the scan as failed. */
const HOLD_TIMEOUT_MS = 3000;

/** Why a send was held. */
const HELD_WARNING = "Sending is paused. Press send again to send anyway.";
const HELD_FAILURE = "DataFog couldn't check this text, so sending is paused.";

/** How long to look for the chat box before warning it can't be found. */
const FIND_TIMEOUT_MS = 10_000;

const site = siteFor(location.hostname);

let composer: HTMLElement | null = null;
let timer: number | undefined;
let seq = 0;
let lastScanned = "";
let lastContent = "";
let unchecked = false;
let dismissedText: string | null = null;
let lastCounts: Record<string, number> = {};
let redaction: Redaction | null = null;
let blockSends = false;
let scanning = false;
let foundText: string | null = null;
let failedText: string | null = null;
let warnedText: string | null = null;
let heldPresses = 0;
let holdTimer: number | undefined;
let sending = false;
/** Whether checking is on. Assumed on if the setting can't be read, so a scan reports why. */
let enabled = true;
const settingsLoaded = loadSettings(location.hostname).then(
  (settings) => {
    enabled = settings.enabled;
  },
  () => {},
);

const badge = new Badge({
  redact: redactComposer,
  pseudonymize: pseudonymizeComposer,
  dismiss,
  undo: undoRedaction,
  redo: redoRedaction,
  send: sendAnyway,
});

// ChatGPT's editor applies some edits itself, such as Backspace over a
// selection, without an input event; the DOM change still shows them
const edits = new MutationObserver(() => schedule(DEBOUNCE_MS));

/**
 * Find the chat box.
 *
 * @returns The chat box element, or null if it isn't on the page.
 */
function findComposer(): HTMLElement | null {
  for (const selector of site.composers) {
    // A page being swapped out can leave its hidden chat box behind
    const element = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    ).find((candidate) => candidate.checkVisibility());
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
 * Whether two readings of the chat box hold the same text. innerText follows
 * layout, so it gains or loses line breaks as an editor redraws, as ChatGPT's
 * does around a link; whitespace alone doesn't count as a change.
 *
 * @param text One reading.
 * @param other The other, if there is one.
 * @returns Whether they match, ignoring whitespace.
 */
function sameText(text: string, other: string | undefined): boolean {
  return (
    other !== undefined &&
    text.replace(/\s+/g, "") === other.replace(/\s+/g, "")
  );
}

/**
 * Note a change to the chat box since it was last looked at. Runs on every
 * keystroke, so it reads textContent, which needs no layout, not innerText.
 *
 * @param element The chat box.
 * @returns The chat box's contents, or null if they haven't changed.
 */
function newContent(element: HTMLElement): string | null {
  const content =
    element instanceof HTMLTextAreaElement
      ? element.value
      : (element.textContent ?? "");
  if (content === lastContent) return null;
  lastContent = content;
  return content;
}

/**
 * Send a request to the service worker.
 *
 * @param request The request.
 * @returns The response, or an error code if it failed.
 */
async function ask<T extends object>(
  request: Request,
): Promise<T | ErrorResponse> {
  try {
    const response = await chrome.runtime.sendMessage<
      Request,
      T | ErrorResponse | undefined
    >(request);
    return response ?? { error: "no_response" };
  } catch {
    // The extension was reloaded under this page; the old script is orphaned
    return { error: "extension_reloaded" };
  }
}

/**
 * Scan the chat box now.
 *
 * @param force Scan even if the text is unchanged.
 */
async function scanNow(force = false): Promise<void> {
  await settingsLoaded;
  if (!composer) return;
  // With checking off the badge is greyed out, and nothing is sent to be checked
  if (!enabled) {
    window.clearTimeout(timer);
    badge.show({ kind: "off" });
    return;
  }
  const text = readText(composer);
  badge.rest(!text.trim());
  if (!force && !unchecked && text === lastScanned) return;
  lastScanned = text;
  unchecked = false;
  // Anything typed since means the redaction no longer lines up with the text
  badge.offer({
    undo: sameText(text, redaction?.after),
    redo: sameText(text, redaction?.before),
  });

  if (!text.trim()) {
    badge.show({ kind: "idle" });
    return;
  }

  // Drop answers to older requests: only the latest text counts
  const mine = ++seq;
  scanning = true;
  badge.show({ kind: "checking" });
  const response = await ask<ScanResponse>({ type: "scan", seq: mine, text });
  if (mine !== seq) return;
  scanning = false;
  if ("error" in response) {
    badge.show({ kind: "failed", code: response.error });
    failedText = text;
    settleHeldSend(text);
    return;
  }

  failedText = null;
  blockSends = response.blockSends;
  lastCounts = response.counts;
  const found = Object.keys(response.counts).length > 0;
  foundText = found ? text : null;
  if (!response.enabled) badge.show({ kind: "off" });
  // A dismissed warning falls back to the plain logo until the text changes
  else if (text === dismissedText) badge.show({ kind: "idle" });
  else
    badge.show(
      found ? { kind: "found", counts: response.counts } : { kind: "clean" },
    );
  settleHeldSend(text);
}

/**
 * Whether text has found values the user hasn't chosen an action for.
 *
 * @param text The text.
 * @returns True if it does.
 */
function unresolved(text: string): boolean {
  return text === foundText && text !== dismissedText;
}

/**
 * Decide whether a send can go ahead, holding it if not.
 *
 * @param repeat Whether this is a held-down key rather than a new press.
 * @returns Whether to let the send through.
 */
function allowSend(repeat: boolean): boolean {
  const text = composer ? readText(composer) : "";
  if (sending || !blockSends || !text.trim()) return sendGoesAhead();
  if (heldPresses > 0) {
    if (!repeat) heldPresses++;
    return false;
  }
  if (scanning || unchecked || text !== lastScanned) {
    holdForScan(text);
    return false;
  }
  if (text === failedText) {
    badge.holdSend(HELD_FAILURE);
    return false;
  }
  if (!unresolved(text)) return sendGoesAhead();
  // The second press after a warning counts as Send anyway
  if (text === warnedText) return repeat ? false : sendGoesAhead();
  warnSend(text);
  return false;
}

/**
 * Clear what a send leaves behind.
 *
 * @returns True, to let the send through.
 */
function sendGoesAhead(): boolean {
  badge.warnFiles(false);
  badge.holdSend(null);
  return true;
}

/**
 * Warn about found values, holding the send until the next press.
 *
 * @param text The text being sent.
 */
function warnSend(text: string): void {
  warnedText = text;
  badge.holdSend(HELD_WARNING);
}

/**
 * Hold a send until its text has been scanned.
 *
 * @param text The text being sent.
 */
function holdForScan(text: string): void {
  heldPresses = 1;
  window.clearTimeout(timer);
  // Never trap a message behind a scan that doesn't answer
  holdTimer = window.setTimeout(() => {
    seq++;
    scanning = false;
    failedText = text;
    badge.show({ kind: "failed", code: "scan_timeout" });
    settleHeldSend(text);
  }, HOLD_TIMEOUT_MS);
  if (!scanning) void scanNow(true);
}

/**
 * Finish a send held for a scan, now that the text's result is in.
 *
 * @param text The text that was scanned.
 */
function settleHeldSend(text: string): void {
  if (heldPresses === 0) return;
  const presses = heldPresses;
  dropHeldSend();
  if (text === failedText) badge.holdSend(HELD_FAILURE);
  else if (!unresolved(text) || presses > 1) sendAnyway();
  else warnSend(text);
}

/** Forget a send held for a scan. */
function dropHeldSend(): void {
  heldPresses = 0;
  window.clearTimeout(holdTimer);
}

/** Send what's in the chat box, past the checks. */
function sendAnyway(): void {
  if (!composer) return;
  // Sending can report again, later, so this text has to stay let through
  warnedText = readText(composer);
  failedText = null;
  sending = true;
  clickSend(composer, site);
  sending = false;
}

/**
 * Scan after the user pauses typing.
 *
 * @param delay Milliseconds to wait; 0 scans on the next tick.
 */
function schedule(delay: number): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void scanNow(), delay);
  const content = composer && newContent(composer);
  if (content === null) return;

  // Text isn't checked until the scan answers, so show that from the keystroke.
  // Moving seq on drops any answer about the text from before this change
  seq++;
  scanning = false;
  unchecked = true;
  warnedText = null;
  dropHeldSend();
  badge.holdSend(null);
  if (enabled && content.trim()) badge.show({ kind: "checking" });
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
  typeLines(element, text);
}

/**
 * Type text over the selection, with the chat box's kind of line break.
 *
 * ChatGPT's editor keeps every line in one paragraph, split by <br>s, and
 * innerText reads each as one newline. Editors with a paragraph per line put
 * two newlines between paragraphs and three more for each blank one, so there
 * n newlines are (n + 1) / 3 paragraph breaks.
 *
 * @param element The chat box.
 * @param text The text, with lines as innerText reads them.
 */
function typeLines(element: HTMLElement, text: string): void {
  if (!text) document.execCommand("delete");
  const oneParagraph = element.children.length <= 1;
  for (const part of text.split(/(\n+)/)) {
    if (part.startsWith("\n")) {
      const breaks = oneParagraph
        ? part.length
        : Math.max(1, Math.round((part.length + 1) / 3));
      const command = oneParagraph ? "insertLineBreak" : "insertParagraph";
      for (let count = 0; count < breaks; count++) {
        document.execCommand(command);
      }
    } else if (part) {
      document.execCommand("insertText", false, part);
    }
  }
}

/**
 * Count a value's occurrences in text that start before a position.
 *
 * @param text The text.
 * @param value The value.
 * @param end Count occurrences starting before this offset.
 * @returns How many there are.
 */
function countBefore(text: string, value: string, end: number): number {
  let count = 0;
  for (
    let at = text.indexOf(value);
    at !== -1 && at < end;
    at = text.indexOf(value, at + value.length)
  ) {
    count++;
  }
  return count;
}

/**
 * Find a value's nth occurrence within a single text node of the chat box.
 *
 * @param root The chat box.
 * @param value The value.
 * @param nth Which occurrence, from 0.
 * @returns A range covering it, or null if it isn't in one text node.
 */
function locate(root: HTMLElement, value: string, nth: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = node.nodeValue ?? "";
    for (
      let at = data.indexOf(value);
      at !== -1;
      at = data.indexOf(value, at + value.length)
    ) {
      if (seen++ < nth) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + value.length);
      return range;
    }
  }
  return null;
}

/**
 * Find a value in the chat box, even across lines: one range from its first
 * line's start to its last line's end, each line in a single text node.
 *
 * @param root The chat box.
 * @param text The chat box's text.
 * @param start Where the value starts in the text.
 * @param end Where it ends.
 * @returns A range covering it, or null if a line isn't in one text node.
 */
function locateSpan(
  root: HTMLElement,
  text: string,
  start: number,
  end: number,
): Range | null {
  const lines = text.slice(start, end).split("\n");
  const first = lines[0];
  const last = lines.at(-1) ?? "";
  if (!first || !last) return null;
  const head = locate(root, first, countBefore(text, first, start));
  if (lines.length === 1 || !head) return head;
  const tail = locate(root, last, countBefore(text, last, end - last.length));
  if (!tail) return null;
  head.setEnd(tail.endContainer, tail.endOffset);
  return head;
}

/** Links that keep their target apart from their text, as ChatGPT's chips do. */
const LINK = "[text-link-href], a[href]";

/**
 * Widen a value's range to the whole link it's in, so the link and the target
 * it holds are replaced with plain text, not just its visible text.
 *
 * @param range The value's range, changed in place.
 * @param replacement What replaces the value.
 * @returns What replaces the range: the link's text with the value replaced,
 *   or null if the value isn't in a link.
 */
function wholeLink(range: Range, replacement: string): string | null {
  const link =
    range.startContainer.parentElement?.closest(LINK) ??
    range.endContainer.parentElement?.closest(LINK);
  if (!link) return null;
  const before = document.createRange();
  before.setStartBefore(link);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEndAfter(link);
  range.setStartBefore(link);
  range.setEndAfter(link);
  return before.toString() + replacement + after.toString();
}

/**
 * Swap each found value for its label with one small edit apiece, so a long
 * prompt with a few values isn't retyped line by line.
 *
 * @param element The chat box.
 * @param text The text that was redacted.
 * @param response The redacted text and where each label goes.
 * @returns Whether every value was found and the chat box now matches.
 */
function replaceValues(
  element: HTMLElement,
  text: string,
  response: RedactResponse,
): boolean {
  const selection = window.getSelection();
  if (!selection) return false;
  element.focus();
  // Last first, so the values before each edit keep their places
  for (let index = response.edits.length - 1; index >= 0; index--) {
    const edit = response.edits[index];
    const range = locateSpan(element, text, edit.start, edit.end);
    if (!range) return false;
    const linked = wholeLink(range, edit.replacement);
    selection.removeAllRanges();
    selection.addRange(range);
    // Typing over a link keeps it, so remove it first
    if (linked !== null) document.execCommand("delete");
    typeLines(element, linked ?? edit.replacement);
  }
  return sameText(readText(element), response.text);
}

/** Redact the chat box's sensitive values in place. */
async function redactComposer(): Promise<void> {
  if (!composer) return;
  const text = readText(composer);
  const response = await ask<RedactResponse>({ type: "redact", text });
  if ("error" in response) {
    // The values are still there, so keep showing what they are
    badge.show({ kind: "failed", code: response.error, counts: lastCounts });
    return;
  }

  await replaceFound(composer, text, response);
}

/**
 * Replace found values in the chat box, keeping the change for Undo.
 *
 * @param element The chat box.
 * @param text Its current text.
 * @param response The new text and the edits that make it.
 */
async function replaceFound(
  element: HTMLElement,
  text: string,
  response: RedactResponse,
): Promise<void> {
  applyEdits(element, text, response);
  redaction = {
    before: text,
    after: readText(element),
    redact: response,
    restore: restoring(text, response),
  };
  dismissedText = null;
  await scanNow(true);
}

/** Ask for the chat box's values to be reviewed in the side panel. */
async function pseudonymizeComposer(): Promise<void> {
  if (!composer) return;
  const response = await ask<object>({
    type: "pseudonymize",
    text: readText(composer),
  });
  if ("error" in response) {
    badge.show({
      kind: "failed",
      code: response.error,
      counts: lastCounts,
      action: "pseudonymize",
    });
  }
}

/**
 * The last element on the page with a marker in it, outside the chat box: a
 * fallback for when the site's answers can't be found by name.
 *
 * @returns The element, or null if no marker is on the page.
 */
function lastMarkedBlock(): Element | null {
  const box = composer?.closest(site.box) ?? composer;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let found: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || box?.contains(parent) || parent.closest("datafog-badge"))
      continue;
    if (MARKER.test(node.textContent ?? "")) found = parent;
  }
  // The answer's whole text block, not only the run with the marker
  return found?.closest("article, li, p, pre, div") ?? found;
}

/**
 * The chat's latest answer.
 *
 * @returns Its element, or null if there's no answer yet.
 */
function latestAnswer(): HTMLElement | null {
  for (const selector of site.answers) {
    const answers = document.querySelectorAll<HTMLElement>(selector);
    const last = answers.item(answers.length - 1);
    if (last?.innerText.trim()) return last;
  }
  const block = lastMarkedBlock();
  return block instanceof HTMLElement ? block : null;
}

/**
 * An answer's text, without the runs of blank lines tables leave.
 *
 * @param element The answer's element.
 * @returns Its text, or null if it has none.
 */
function answerText(element: HTMLElement | null): string | null {
  const text = element?.innerText.replaceAll(/\n{3,}/g, "\n\n").trim();
  return text ? text : null;
}

/**
 * Answer the service worker: the chat box's text, the latest answer,
 * or markers to put in the chat box.
 *
 * @param request The request.
 * @returns The response.
 */
async function answer(request: TabRequest): Promise<object> {
  if (request.type === "chat-text") {
    return { text: composer ? readText(composer) : null };
  }
  if (request.type === "latest-answer") {
    // Shown values aren't in the page's text; read the markers under them
    hideOriginals();
    return { text: answerText(latestAnswer()) };
  }
  if (request.type === "show-originals") {
    const latest = latestAnswer();
    return { shown: latest ? showOriginals(latest, request.values) : 0 };
  }
  if (request.type === "hide-originals") {
    hideOriginals();
    return {};
  }
  // Approved in the side panel for this text; anything since wins
  if (!composer || readText(composer) !== request.before) {
    return { error: "chat_box_changed" };
  }
  await replaceFound(composer, request.before, request.response);
  return {};
}

/**
 * Change the chat box with edits, retyping it all only when the values can't
 * be edited in place.
 *
 * @param element The chat box.
 * @param text Its current text.
 * @param response The new text and the edits that make it.
 */
function applyEdits(
  element: HTMLElement,
  text: string,
  response: RedactResponse,
): void {
  if (
    element instanceof HTMLTextAreaElement ||
    !replaceValues(element, text, response)
  ) {
    replaceText(element, response.text);
  }
  // The caller rescans now, so the DOM change needs no scan of its own
  newContent(element);
  warnedText = null;
  badge.holdSend(null);
}

/**
 * Work out the edits that take redacted text back to the original.
 *
 * @param text The original text.
 * @param response The redacted text and the edits that made it.
 * @returns The original text and the edits that restore it.
 */
function restoring(text: string, response: RedactResponse): RedactResponse {
  let shift = 0;
  const restored = response.edits.map(({ start, end, replacement }) => {
    const edit = {
      start: start + shift,
      end: start + shift + replacement.length,
      replacement: text.slice(start, end),
    };
    shift += replacement.length - (end - start);
    return edit;
  });
  return { text, edits: restored };
}

/** Put back the values the last redaction replaced. */
function undoRedaction(): void {
  if (!composer || !redaction) return;
  if (!sameText(readText(composer), redaction.after)) return;
  applyEdits(composer, redaction.after, redaction.restore);
  void scanNow(true);
}

/** Redact the same values again. */
function redoRedaction(): void {
  if (!composer || !redaction) return;
  if (!sameText(readText(composer), redaction.before)) return;
  applyEdits(composer, redaction.before, redaction.redact);
  void scanNow(true);
}

/** Open or close the side panel; an orphaned script can only ask for a reload. */
async function togglePanel(): Promise<void> {
  const response = await ask<object>({ type: "open-panel" });
  if ("error" in response && response.error === "extension_reloaded")
    badge.show({ kind: "failed", code: response.error });
}

/** Clear the warning until the text changes. */
function dismiss(): void {
  if (!composer) return;
  dismissedText = readText(composer);
  badge.holdSend(null);
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
  redaction = null;
  newContent(element);
  // The outer chat box outlasts changes to the editor inside
  badge.attach(element.closest(site.box) ?? element);
  warnTab();
  element.addEventListener("input", () => {
    // Before the box grows with the text, so the badge keeps its empty height
    badge.rest(!readText(element).trim());
    schedule(DEBOUNCE_MS);
  });
  edits.disconnect();
  edits.observe(element, {
    characterData: true,
    childList: true,
    subtree: true,
  });
  // Pasted text lands after the event; scan on the next tick, not after a pause
  element.addEventListener("paste", () => schedule(0));
  void ask({ type: "protection", protected: true });
  void ask<BlockSendsResponse>({ type: "block-sends" }).then((response) => {
    if (!("error" in response)) blockSends = response.blockSends;
  });
  void scanNow(true);
}

// ChatGPT re-renders the chat box when switching conversations, and moves it
// between layouts, such as to the middle of a new chat, without resizing it
new MutationObserver(() => {
  const element = findComposer();
  if (element && element !== composer) bind(element);
  else badge.reposition();
}).observe(document.documentElement, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener(
  (request: TabRequest, _sender, respond) => {
    void answer(request).then(respond);
    return true;
  },
);

// Turning checking off greys out the badge and closes its panel at once; turning it on
// checks the chat box as it stands
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // An update downloaded while the chat box is missing may fix it
  if (PENDING_UPDATE in changes && missing && !composer) void warnMissing();
  const next = (changes.settings?.newValue ?? {}) as { off?: unknown };
  if (!Array.isArray(next.off)) return;
  const on = !next.off.includes(location.hostname);
  if (on === enabled) return;
  enabled = on;
  void scanNow(true);
});

// The page tab opens or closes the side panel; send right away, within the click
const warnTab = mountTab(() => void togglePanel());

/** Whether the chat box went unfound for the whole wait. */
let missing = false;

/**
 * Warn that the chat box is missing, and that an update may fix it if one is
 * waiting.
 */
async function warnMissing(): Promise<void> {
  const response = await ask<{ updateReady?: boolean }>({
    type: "protection",
    protected: false,
  });
  // Found while asking
  if (composer) return;
  const ready = !("error" in response) && response.updateReady === true;
  warnTab(ready ? NO_CHAT_BOX_UPDATE : NO_CHAT_BOX);
}

watchPage(() => composer, {
  send: allowSend,
  files: () => badge.warnFiles(true),
});

const initial = findComposer();
if (initial) bind(initial);

window.setTimeout(() => {
  if (composer) return;
  missing = true;
  warnTab(NO_CHAT_BOX);
  void warnMissing();
}, FIND_TIMEOUT_MS);
