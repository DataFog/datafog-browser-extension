/**
 * Content script on each chat site: watches the chat box as the user types.
 *
 * Redact and Pseudonymize edit the chat box; Dismiss hides the warning, and the
 * user sends with ChatGPT's own button. Pseudonymize is reviewed in the side
 * panel, and its markers come back from the service worker once approved.
 */

import { Badge } from "./badge";
import {
  type BlockSendsResponse,
  type ErrorResponse,
  type RedactResponse,
  type Request,
  type ScanResponse,
  type TabRequest,
} from "./messages";
import {
  hideOriginals,
  MARKER,
  showOriginals,
  watchAnswers,
} from "./originals";
import { clickSend, watchPage } from "./page";
import { loadSettings } from "./settings";
import { claimPage, isRetired, onRetire } from "./single";
import { siteFor } from "./site";
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

// A live copy is already on this page (see single.ts): leave it be
if (!claimPage()) throw new Error("datafog is already running on this page");

const site = siteFor(location.hostname);

let composer: HTMLElement | null = null;
let timer: number | undefined;
let seq = 0;
let lastScanned = "";
let lastContent = "";
type ScanState =
  | { kind: "idle" | "dirty" | "disabled" }
  | { kind: "checking"; text: string; seq: number }
  | { kind: "checked"; text: string; found: boolean }
  | { kind: "unavailable"; text: string; code: string };
let scanState: ScanState = { kind: "idle" };
let dismissedText: string | null = null;
let redaction: Redaction | null = null;
let blockSends = false;
type SendState =
  | { kind: "ready" }
  | { kind: "held"; presses: number }
  | { kind: "warned" | "overridden"; text: string };
let sendState: SendState = { kind: "ready" };
let holdTimer: number | undefined;
let sending = false;
let revision = 0;
let operationId = 0;
type ActionState =
  | { kind: "idle" }
  | { kind: "working"; message: string; operationId: number; revision: number }
  | { kind: "complete" | "failed"; message: string }
  | { kind: "superseded"; operationId: number };
let actionState: ActionState = { kind: "idle" };
let applying = false;
let findings: { entityType: string; original: string; marker: string }[] = [];
let previewId: string | undefined;
/** Whether checking is on. Assumed on if the setting can't be read, so a scan reports why. */
let enabled = true;
let settingsError = false;
let expectedPolicyVersion: string | undefined;
let policyRefresh = 0;
/**
 * Load this site's settings again after a first failure, a few times. A copy
 * injected right after an install or update can start while the vault is
 * still opening.
 *
 * @returns The settings.
 */
async function retrySettings(): ReturnType<typeof loadSettings> {
  for (let attempt = 0; ; attempt++) {
    await new Promise((resolve) =>
      window.setTimeout(resolve, 250 * 2 ** attempt),
    );
    try {
      return await loadSettings(location.hostname);
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}
function applySettings(settings: Awaited<ReturnType<typeof loadSettings>>) {
  if (policyRefresh !== 0) return;
  enabled = settings.enabled;
  expectedPolicyVersion = settings.policyVersion ?? expectedPolicyVersion;
  blockSends = settings.enabled && settings.blockSends;
}
const settingsLoaded = loadSettings(location.hostname).then(applySettings, () =>
  retrySettings().then(applySettings, () => {
    if (policyRefresh === 0) settingsError = true;
  }),
);

const badge = new Badge({
  redact: redactComposer,
  pseudonymize: pseudonymizeComposer,
  dismiss,
  undo: undoRedaction,
  redo: redoRedaction,
  send: sendAnyway,
  sidebar: () => void togglePanel(),
  allow: () => void alwaysAllow(),
  retry: () => void refreshPolicy(),
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
  if (settingsError) {
    scanState = {
      kind: "unavailable",
      text: readText(composer),
      code: "settings_unavailable",
    };
    badge.show({ kind: "failed", code: "settings_unavailable" });
    return;
  }
  // With checking off the badge is greyed out, and nothing is sent to be checked
  if (!enabled) {
    window.clearTimeout(timer);
    scanState = { kind: "disabled" };
    badge.show({ kind: "off" });
    return;
  }
  const text = readText(composer);
  if (!force && scanState.kind !== "dirty" && text === lastScanned) return;
  lastScanned = text;
  // Anything typed since means the redaction no longer lines up with the text
  badge.offer({
    undo: sameText(text, redaction?.after),
    redo: sameText(text, redaction?.before),
  });

  if (!text.trim()) {
    scanState = { kind: "idle" };
    badge.show({ kind: "idle" });
    return;
  }

  // Drop answers to older requests: only the latest text counts
  const mine = ++seq;
  scanState = { kind: "checking", text, seq: mine };
  badge.show({ kind: "checking" });
  const response = await ask<ScanResponse>({ type: "scan", seq: mine, text });
  if (mine !== seq || composer === null || readText(composer) !== text) return;
  if ("error" in response) {
    badge.show({ kind: "failed", code: response.error });
    scanState = { kind: "unavailable", text, code: response.error };
    settleHeldSend(text);
    return;
  }

  if (
    expectedPolicyVersion &&
    response.policyVersion !== expectedPolicyVersion
  ) {
    scanState = { kind: "dirty" };
    badge.show({ kind: "checking" });
    return;
  }
  blockSends = response.blockSends;
  findings = response.findings ?? [];
  previewId = response.previewId;
  badge.preview(findings);
  const found = Object.keys(response.counts).length > 0;
  scanState = { kind: "checked", text, found };
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
  return (
    scanState.kind === "checked" &&
    scanState.found &&
    text === scanState.text &&
    text !== dismissedText
  );
}

/**
 * Decide whether a send can go ahead, holding it if not.
 *
 * @param repeat Whether this is a held-down key rather than a new press.
 * @returns Whether to let the send through.
 */
function allowSend(repeat: boolean): boolean {
  // A retired copy never holds a send; the newer copy decides
  if (isRetired()) return true;
  const text = composer ? readText(composer) : "";
  if (sending || !blockSends || !text.trim()) return sendGoesAhead();
  if (sendState.kind === "overridden" && sendState.text === text)
    return sendGoesAhead();
  if (sendState.kind === "held") {
    if (!repeat) sendState.presses++;
    return false;
  }
  if (
    scanState.kind === "checking" ||
    scanState.kind === "dirty" ||
    text !== lastScanned
  ) {
    holdForScan(text);
    return false;
  }
  if (scanState.kind === "unavailable" && text === scanState.text) {
    badge.holdSend(HELD_FAILURE);
    return false;
  }
  if (!unresolved(text)) return sendGoesAhead();
  // The second press after a warning counts as Send anyway
  if (sendState.kind === "warned" && text === sendState.text) {
    if (repeat) return false;
    sendState = { kind: "overridden", text };
    return sendGoesAhead();
  }
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
  sendState = { kind: "warned", text };
  badge.holdSend(HELD_WARNING);
}

/**
 * Hold a send until its text has been scanned.
 *
 * @param text The text being sent.
 */
function holdForScan(text: string): void {
  sendState = { kind: "held", presses: 1 };
  window.clearTimeout(timer);
  // Never trap a message behind a scan that doesn't answer
  holdTimer = window.setTimeout(() => {
    seq++;
    scanState = { kind: "unavailable", text, code: "scan_timeout" };
    badge.show({ kind: "failed", code: "scan_timeout" });
    settleHeldSend(text);
  }, HOLD_TIMEOUT_MS);
  if (scanState.kind !== "checking") void scanNow(true);
}

/**
 * Finish a send held for a scan, now that the text's result is in.
 *
 * @param text The text that was scanned.
 */
function settleHeldSend(text: string): void {
  if (sendState.kind !== "held") return;
  const presses = sendState.presses;
  dropHeldSend();
  if (scanState.kind === "unavailable" && text === scanState.text)
    badge.holdSend(HELD_FAILURE);
  else if (!unresolved(text) || presses > 1) sendAnyway();
  else warnSend(text);
}

/** Forget a send held for a scan. */
function dropHeldSend(): void {
  if (sendState.kind === "held") sendState = { kind: "ready" };
  window.clearTimeout(holdTimer);
}

/** Send what's in the chat box, past the checks. */
function sendAnyway(): void {
  if (!composer) return;
  // Sending can report again, later, so this text has to stay let through
  sendState = { kind: "overridden", text: readText(composer) };
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
  if (isRetired()) return;
  if (applying) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void scanNow(), delay);
  const content = composer && newContent(composer);
  if (content === null) return;

  // Text isn't checked until the scan answers, so show that from the keystroke.
  // Moving seq on drops any answer about the text from before this change
  seq++;
  revision++;
  const superseded =
    actionState.kind === "working" || actionState.kind === "superseded"
      ? actionState.operationId
      : undefined;
  operationId++;
  redaction = null;
  dismissedText = null;
  findings = [];
  previewId = undefined;
  badge.preview([]);
  updateAction(
    superseded === undefined
      ? { kind: "idle" }
      : { kind: "superseded", operationId: superseded },
  );
  badge.offer({ undo: false, redo: false });
  scanState = { kind: "dirty" };
  sendState = { kind: "ready" };
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

function updateAction(state: ActionState): void {
  actionState = state;
  badge.operation(
    "message" in state ? state.message : "",
    state.kind === "working",
  );
}

/** Transform a captured draft, applying only after a confirmed response. */
async function transform(kind: "redact" | "pseudonymize"): Promise<void> {
  if (!composer || actionState.kind === "working") return;
  const element = composer;
  const text = readText(element);
  const capturedRevision = revision;
  const mine = ++operationId;
  updateAction({
    kind: "working",
    message: kind === "pseudonymize" ? "Saving originals…" : "Redacting…",
    operationId: mine,
    revision: capturedRevision,
  });
  const response = await ask<
    RedactResponse & { saved?: boolean; warning?: string }
  >(
    kind === "pseudonymize" && previewId
      ? { type: kind, text, previewId }
      : { type: kind, text },
  );
  if (
    mine !== operationId ||
    capturedRevision !== revision ||
    composer !== element ||
    readText(element) !== text
  ) {
    if (
      actionState.kind === "superseded" &&
      actionState.operationId === mine &&
      !("error" in response) &&
      response.saved === true
    )
      updateAction({
        kind: "complete",
        message:
          "Originals from the earlier draft were saved. Your newer draft is unchanged.",
      });
    return;
  }
  if ("error" in response && response.error === "preview_expired") {
    previewId = undefined;
    findings = [];
    badge.preview([]);
    updateAction({
      kind: "working",
      message: "Refreshing preview…",
      operationId: mine,
      revision: capturedRevision,
    });
    await scanNow(true);
    if (
      mine === operationId &&
      revision === capturedRevision &&
      composer === element &&
      readText(element) === text
    ) {
      updateAction({
        kind: "failed",
        message:
          "The preview expired and was refreshed. Your draft is unchanged. Check it, then Replace again.",
      });
    }
    return;
  }
  if ("error" in response) {
    updateAction({
      kind: "failed",
      message: `Couldn’t ${kind === "redact" ? "redact" : "confirm the encrypted save"}. Your draft is unchanged. Retry the action to reconcile storage. (${response.error})`,
    });
    return;
  }
  if (kind === "pseudonymize" && response.saved !== true) {
    updateAction({
      kind: "failed",
      message:
        "The save could not be confirmed. Your draft is unchanged. Replace again to retry.",
    });
    return;
  }
  const applied = await replaceFound(element, text, response);
  if (
    composer !== element ||
    (applied && !sameText(readText(element), response.text))
  )
    return;
  updateAction({
    kind: applied ? "complete" : "failed",
    message: applied
      ? kind === "pseudonymize"
        ? response.warning
          ? "Replaced. Originals saved; storage will retry a detail. Tokens still restore."
          : "Replaced. Originals saved in your vault."
        : "Redacted. Nothing was saved."
      : kind === "pseudonymize"
        ? "Originals saved, but the editor did not accept the change. Nothing was sent."
        : "The editor didn't take the full change. Check your draft before sending.",
  });
}

async function redactComposer(): Promise<void> {
  await transform("redact");
}
async function pseudonymizeComposer(): Promise<void> {
  await transform("pseudonymize");
}

async function alwaysAllow(): Promise<void> {
  if (actionState.kind === "working" || !findings.length) return;
  const captured = [...findings];
  const mine = ++operationId;
  updateAction({
    kind: "working",
    message: "Saving Always allow…",
    operationId: mine,
    revision,
  });
  for (const item of captured) {
    const response = await ask<object>({
      type: "always-allow",
      entityType: item.entityType,
      value: item.original,
    });
    if ("error" in response) {
      updateAction({
        kind: "failed",
        message: `Couldn’t confirm every rule. Retry to check the committed policy. (${response.error})`,
      });
      await refreshPolicy();
      return;
    }
  }
  if (mine === operationId)
    updateAction({
      kind: "complete",
      message: "Always allowed. Always flag still wins.",
    });
  await refreshPolicy();
}

async function replaceFound(
  element: HTMLElement,
  text: string,
  response: RedactResponse,
): Promise<boolean> {
  if (element !== composer || readText(element) !== text) return false;
  applyEdits(element, text, response);
  const applied = sameText(readText(element), response.text);
  redaction = applied
    ? {
        before: text,
        after: readText(element),
        redact: response,
        restore: restoring(text, response),
      }
    : null;
  dismissedText = null;
  await scanNow(true);
  return applied;
}

/** A committed policy invalidates every pending scan and per-draft choice. */
async function refreshPolicy(): Promise<void> {
  const refresh = ++policyRefresh;
  answerVisibility.refresh();
  seq++;
  operationId++;
  if (actionState.kind === "working")
    updateAction({ kind: "superseded", operationId: actionState.operationId });
  findings = [];
  previewId = undefined;
  badge.preview([]);
  badge.show({ kind: "checking" });
  dismissedText = null;
  sendState = { kind: "ready" };
  dropHeldSend();
  scanState = { kind: "dirty" };
  try {
    const settings = await loadSettings(location.hostname);
    if (refresh !== policyRefresh) return;
    enabled = settings.enabled;
    expectedPolicyVersion = settings.policyVersion ?? expectedPolicyVersion;
    settingsError = false;
    blockSends = settings.enabled && settings.blockSends;
  } catch {
    if (refresh !== policyRefresh) return;
    settingsError = true;
    badge.show({ kind: "failed", code: "settings_unavailable" });
    scanState = {
      kind: "unavailable",
      text: composer ? readText(composer) : "",
      code: "settings_unavailable",
    };
    return;
  }
  await scanNow(true);
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
  if (request.type === "recheck") {
    expectedPolicyVersion = request.policyVersion ?? expectedPolicyVersion;
    void refreshPolicy();
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
  applying = true;
  try {
    if (
      element instanceof HTMLTextAreaElement ||
      !replaceValues(element, text, response)
    )
      replaceText(element, response.text);
  } finally {
    applying = false;
  }
  // The caller rescans now, so the DOM change needs no scan of its own
  newContent(element);
  sendState = { kind: "ready" };
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
  element.addEventListener("input", () => {
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
const composers = new MutationObserver(() => {
  const element = findComposer();
  if (element && element !== composer) bind(element);
  else badge.reposition();
});
composers.observe(document.documentElement, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener(
  (request: TabRequest, _sender, respond) => {
    void answer(request).then(respond);
    return true;
  },
);

// Only bootstrap notices are read here; policy itself comes from encrypted storage.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (PENDING_UPDATE in changes && missing && !composer) void warnMissing();
  if (
    "policyVersion" in changes &&
    typeof changes.policyVersion.newValue === "string"
  )
    expectedPolicyVersion = changes.policyVersion.newValue;
  if ("settings" in changes || "policyVersion" in changes) void refreshPolicy();
});

const answerVisibility = watchAnswers(site, async (text) =>
  ask({ type: "restore", text }),
);

// Handed over to a newer copy: take down everything this copy shows
onRetire(() => {
  window.clearTimeout(timer);
  composers.disconnect();
  edits.disconnect();
  answerVisibility.dispose();
  badge.destroy();
});

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
  badge.show({
    kind: "failed",
    code: ready ? "update_ready_no_composer" : "no_composer",
  });
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

  void warnMissing();
}, FIND_TIMEOUT_MS);
