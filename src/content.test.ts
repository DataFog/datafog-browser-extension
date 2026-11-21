// @vitest-environment happy-dom
/**
 * The content script's badge when the service worker answers, fails, or is
 * gone.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { OFF_TITLE } from "./badge";
import { DEFAULT_SETTINGS } from "./settings";
let savedSettings = { ...DEFAULT_SETTINGS };
let settingsFailure = false;
import { type RedactResponse, type Request, type TabRequest } from "./messages";

type Reply = (request: Request) => Promise<unknown>;

type TabListener = (
  request: TabRequest,
  sender: object,
  respond: (response: unknown) => void,
) => boolean;

/** The content script's listener for the service worker's requests. */
let tabListener: TabListener;

type StorageListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: string,
) => void;

/** The content script's listener for settings changes. */
let storageListener: StorageListener;

/**
 * Save checking on or off, as the settings page would.
 *
 * @param enabled Whether checking is on.
 */
async function setChecking(enabled: boolean): Promise<void> {
  const off = enabled ? [] : [location.hostname];
  savedSettings = { ...savedSettings, off };
  storageListener({ settings: { newValue: { off } } }, "local");
  await vi.advanceTimersByTimeAsync(0);
}

const PAGE = '<form><textarea id="prompt-textarea"></textarea></form>';

/**
 * Load a fresh content script against a page with a chat box.
 *
 * @param reply How the stubbed service worker answers each request.
 * @param page The page's markup; its last textarea is the visible chat box.
 * @param enabled Whether checking is on in the saved settings.
 * @returns The visible chat box.
 */
async function start(
  reply: Reply,
  page = PAGE,
  enabled = true,
): Promise<HTMLTextAreaElement> {
  document.body.innerHTML = page;
  settingsFailure = false;
  savedSettings = {
    ...DEFAULT_SETTINGS,
    off: enabled ? [] : [location.hostname],
  };
  Object.assign(globalThis, {
    chrome: {
      storage: {
        local: {
          get: async () => ({
            settings: { off: enabled ? [] : [location.hostname] },
          }),
        },
        onChanged: {
          addListener: (added: StorageListener) => (storageListener = added),
        },
      },
      runtime: {
        sendMessage: vi.fn((request) =>
          request.type === "settings-get"
            ? Promise.resolve(
                settingsFailure
                  ? { error: "storage_unavailable" }
                  : savedSettings,
              )
            : reply(request),
        ),
        onMessage: {
          addListener: (added: TabListener) => (tabListener = added),
        },
      },
    },
  });
  await import("./content");
  return Array.from(document.querySelectorAll("textarea")).at(-1)!;
}

/**
 * Type into the chat box and wait out the scan's debounce.
 *
 * @param box The chat box.
 * @param text The new text.
 */
async function type(box: HTMLTextAreaElement, text: string): Promise<void> {
  box.value = text;
  box.dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(400);
}

/**
 * Read the badge, whose shadow root the test opened.
 *
 * @returns The badge's dot and panel title.
 */
function badge(): { dot: HTMLElement; title: string } {
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  return {
    dot: root.querySelector<HTMLElement>(".dot")!,
    title: root.querySelector("h2")!.textContent ?? "",
  };
}

/** Undoes what each loaded content script hooked into the shared document. */
const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (name: string, listener: EventListenerOrEventListenerObject, options) => {
      add(name, listener, options);
      cleanups.push(() =>
        document.removeEventListener(name, listener, options),
      );
    },
  );
  // oxlint-disable-next-line typescript/unbound-method -- called with this below
  const observe = MutationObserver.prototype.observe;
  vi.spyOn(MutationObserver.prototype, "observe").mockImplementation(function (
    this: MutationObserver,
    target: Node,
    options?: MutationObserverInit,
  ) {
    observe.call(this, target, options);
    cleanups.push(() => this.disconnect());
  });
  // The badge's shadow root is closed; open it so the test can see it
  // oxlint-disable-next-line typescript/unbound-method -- called with this below
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    return attach.call(this, { ...init, mode: "open" });
  });
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
});

test("shows the count when the scan succeeds", async () => {
  const box = await start(async (request) =>
    request.type === "scan"
      ? { seq: request.seq, enabled: true, counts: { EMAIL: 1 } }
      : {},
  );
  await type(box, "jane@example.com");
  expect(badge().dot.className).toBe("dot found");
  expect(badge().dot.textContent).toBe("1");
});

test("shows a failure, not checking, when the scan errors", async () => {
  const box = await start(async (request) =>
    request.type === "scan" ? { error: "datafog_failed" } : {},
  );
  await type(box, "jane@example.com");
  expect(badge().dot.className).toBe("dot failed");
  expect(badge().dot.textContent).toBe("!");
  expect(badge().title).toBe("datafog couldn't check this text");
});

test("asks for a page reload when the extension was updated", async () => {
  const box = await start(async (request) => {
    if (request.type === "scan")
      throw new Error("Extension context invalidated");
    return {};
  });
  await type(box, "jane@example.com");
  expect(badge().dot.className).toBe("dot failed");
  expect(badge().title).toBe("datafog was updated");
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  expect(root.querySelector(".note")!.textContent).toBe(
    "Reload this page to keep checking this chat box.",
  );
});

test("preserves the draft and offers retry when Redact errors", async () => {
  const box = await start(async (request) =>
    request.type === "scan"
      ? { seq: request.seq, enabled: true, counts: { EMAIL: 1 } }
      : request.type === "redact"
        ? { error: "review_conflict" }
        : {},
  );
  await type(box, "jane@example.com");
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  root.querySelector<HTMLButtonElement>(".redact")!.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(root.querySelector(".progress")!.textContent).toContain(
    "draft is unchanged",
  );
  expect(root.querySelector<HTMLButtonElement>(".redact")!.disabled).toBe(
    false,
  );
  expect(box.value).toBe("jane@example.com");
});

test("watches the visible chat box, not one a page change left hidden", async () => {
  const box = await start(
    async (request) =>
      request.type === "scan"
        ? { seq: request.seq, enabled: true, counts: { EMAIL: 1 } }
        : {},
    `<div style="display: none">${PAGE}</div>${PAGE}`,
  );
  await type(box, "jane@example.com");
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "scan", text: "jane@example.com" }),
  );
  expect(badge().dot.className).toBe("dot found");
});

test("returns to the logo when the editor clears the text without an input event", async () => {
  await start(
    async (request) =>
      request.type === "scan"
        ? { seq: request.seq, enabled: true, counts: { EMAIL: 1 } }
        : {},
    '<form><div id="prompt-textarea" contenteditable="true"><p>jane@example.com</p></div></form>',
  );
  const box = document.querySelector<HTMLElement>("#prompt-textarea")!;
  box.dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(400);
  expect(badge().dot.className).toBe("dot found");

  // As ChatGPT does for Ctrl+A then Backspace: the DOM changes, no input event
  box.replaceChildren(document.createElement("p"));
  await vi.advanceTimersByTimeAsync(400);

  expect(badge().dot.className).toBe("dot idle");
});

/**
 * Stand in for the browser's editing commands, which happy-dom lacks.
 * insertText replaces the selection, as it does in a real editor.
 *
 * @returns The stub, to see which commands ran.
 */
function stubEditing(): ReturnType<typeof vi.fn> {
  const exec = vi.fn((command: string, _ui?: boolean, value?: string) => {
    if (command === "insertText") {
      const range = window.getSelection()!.getRangeAt(0);
      const { startContainer, startOffset, endContainer, endOffset } = range;
      const first = startContainer.parentElement!.closest("p");
      const last = endContainer.parentElement!.closest("p");
      if (first && last && first !== last) {
        // Across paragraphs: join them around the new text, as an editor does
        const before = startContainer.textContent!.slice(0, startOffset);
        const after = endContainer.textContent!.slice(endOffset);
        while (first.nextSibling !== last) first.nextSibling!.remove();
        first.textContent = before + (value ?? "") + after;
        last.remove();
      } else {
        range.deleteContents();
        const node = document.createTextNode(value ?? "");
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
      }
    }
    if (command === "delete") {
      const range = window.getSelection()!.getRangeAt(0);
      range.deleteContents();
      range.collapse(true);
    }
    if (command === "insertLineBreak") {
      const range = window.getSelection()!.getRangeAt(0);
      const br = document.createElement("br");
      range.insertNode(br);
      range.setStartAfter(br);
      range.collapse(true);
    }
    if (command === "insertParagraph") {
      // Split the paragraph at the caret, moving the caret to the new one
      const range = window.getSelection()!.getRangeAt(0);
      const block = (
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement!
      ).closest("p")!;
      const rest = document.createRange();
      rest.setStart(range.startContainer, range.startOffset);
      rest.setEnd(block, block.childNodes.length);
      const next = document.createElement("p");
      next.append(rest.extractContents());
      block.after(next);
      range.setStart(next, 0);
      range.collapse(true);
    }
    return true;
  });
  Object.assign(document, { execCommand: exec });
  return exec;
}

/**
 * Load the content script on a rich-text chat box and choose Redact.
 *
 * @param lines The chat box's paragraphs, as markup.
 * @param value The value to redact, as [EMAIL].
 * @returns The chat box.
 */
async function redactRichText(
  lines: string[],
  value = "jane@example.com",
): Promise<HTMLElement> {
  await start(
    async (request) => {
      if (request.type === "scan")
        return { seq: request.seq, enabled: true, counts: { EMAIL: 1 } };
      if (request.type !== "redact") return {};
      const at = request.text.indexOf(value);
      return {
        text: request.text.replace(value, "[EMAIL]"),
        edits: [{ start: at, end: at + value.length, replacement: "[EMAIL]" }],
      };
    },
    `<form><div id="prompt-textarea" contenteditable="true">${lines
      .map((line) => `<p>${line}</p>`)
      .join("")}</div></form>`,
  );
  const box = document.querySelector<HTMLElement>("#prompt-textarea")!;
  box.dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(400);
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  root.querySelector<HTMLButtonElement>(".redact")!.click();
  await vi.advanceTimersByTimeAsync(0);
  return box;
}

test("redacts a long prompt with one edit per value", async () => {
  const exec = stubEditing();
  const filler = Array.from({ length: 300 }, (_, index) => `line ${index}`);

  const box = await redactRichText(["Contact: jane@example.com", ...filler]);

  expect(exec.mock.calls).toEqual([["insertText", false, "[EMAIL]"]]);
  expect(box.textContent).toContain("Contact: [EMAIL]");
  expect(box.textContent).not.toContain("jane@example.com");
});

test("replaces a link chip with plain text, so its target goes too", async () => {
  const exec = stubEditing();
  const url = "https://example.com/u/jane@example.com/profile";

  const box = await redactRichText([
    `in url: <span title="${url}" text-link-href="${url}"><span>${url}</span></span> ok`,
  ]);

  expect(exec.mock.calls).toEqual([
    ["delete"],
    ["insertText", false, "https://example.com/u/[EMAIL]/profile"],
  ]);
  expect(box.textContent).toBe(
    "in url: https://example.com/u/[EMAIL]/profile ok",
  );
  expect(box.innerHTML).not.toContain("jane@example.com");
});

test("redacts a value across lines in place", async () => {
  const exec = stubEditing();

  const box = await redactRichText(
    ["Ship to", "77 Harbor View Lane", "Port Ellison, WA 98366", "Thanks"],
    "77 Harbor View Lane\nPort Ellison, WA 98366",
  );

  expect(exec.mock.calls).toEqual([["insertText", false, "[EMAIL]"]]);
  expect(box.innerText).toBe("Ship to\n[EMAIL]\nThanks");
});

test("undoes a value across lines in place, a paragraph per line", async () => {
  const exec = stubEditing();
  const lines = ["Ship to", "77 Harbor View Lane", "Port Ellison, WA 98366"];
  const box = await redactRichText(
    [...lines, "Thanks"],
    "77 Harbor View Lane\nPort Ellison, WA 98366",
  );
  exec.mockClear();

  await press("undo");

  expect(box.innerText).toBe([...lines, "Thanks"].join("\n"));
  expect(box.querySelectorAll("p")).toHaveLength(4);
  expect(exec).not.toHaveBeenCalledWith("selectAll");
});

test("undoes in place in one paragraph of lines, as ChatGPT's editor has", async () => {
  const exec = stubEditing();
  const value = "77 Harbor View Lane\nPort Ellison";
  const markup =
    "<p>Ship to<br>77 Harbor View Lane<br>Port Ellison<br><br>Thanks</p>";
  await start(async (request) => {
    if (request.type === "scan")
      return { seq: request.seq, enabled: true, counts: { ADDRESS: 1 } };
    if (request.type !== "redact") return {};
    const at = request.text.indexOf(value);
    return {
      text: request.text.replace(value, "[ADDRESS]"),
      edits: [{ start: at, end: at + value.length, replacement: "[ADDRESS]" }],
    };
  }, `<form><div id="prompt-textarea" contenteditable="true">${markup}</div></form>`);
  const box = document.querySelector<HTMLElement>("#prompt-textarea")!;
  // happy-dom's innerText skips <br>; Chromium reads each as a newline
  Object.defineProperty(box, "innerText", {
    get: () =>
      [...box.querySelectorAll("p")[0].childNodes]
        .map((node) => (node.nodeName === "BR" ? "\n" : node.textContent))
        .join(""),
  });
  box.dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(400);
  await press("redact");
  expect(box.innerHTML).toContain("[ADDRESS]");
  exec.mockClear();

  await press("undo");

  expect(box.innerHTML).toBe(markup);
  expect(exec).toHaveBeenCalledWith("insertLineBreak");
  expect(exec).not.toHaveBeenCalledWith("selectAll");
});

test("retypes the chat box when a value spans formatting", async () => {
  const exec = stubEditing();

  await redactRichText(["Contact: jane@<b>example.com</b>"]);

  expect(exec).toHaveBeenCalledWith("selectAll");
});

test("shows the failure code, so it can be reported", async () => {
  const box = await start(async (request) =>
    request.type === "scan" ? { error: "review_conflict" } : {},
  );
  await type(box, "jane@example.com");
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  expect(root.querySelector(".note")!.textContent).toBe(
    "Reload the page to try again. Error code: review_conflict",
  );
});

test("offers ways to report a failure, but not an update", async () => {
  let code = "review_conflict";
  const box = await start(async (request) =>
    request.type === "scan" ? { error: code } : {},
  );
  await type(box, "jane@example.com");
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  const report = root.querySelector<HTMLElement>(".report")!;
  const links = report.querySelectorAll("a");
  expect(report.hidden).toBe(false);
  expect([...links].map((link) => link.href)).toEqual([
    "mailto:help@datafog.ai",
  ]);
  expect(report.textContent).toContain("Report this problem to");

  code = "extension_reloaded";
  await type(box, "jane@example.org");
  expect(report.hidden).toBe(true);
});

test("shows pulsing dots until the scan answers", async () => {
  const answers: (() => void)[] = [];
  const box = await start((request) =>
    request.type === "scan"
      ? new Promise((resolve) => {
          answers.push(() =>
            resolve({ seq: request.seq, enabled: true, counts: {} }),
          );
        })
      : Promise.resolve({}),
  );
  await type(box, "jane@example.com");
  expect(badge().dot.className).toBe("dot checking");
  expect(badge().dot.querySelectorAll(".dots i")).toHaveLength(3);

  answers.forEach((answer) => answer());
  await vi.advanceTimersByTimeAsync(0);
  expect(badge().dot.querySelector(".dots")).toBeNull();
});

test("shows the dots from the keystroke, before the scan starts", async () => {
  const box = await start(async (request) =>
    request.type === "scan"
      ? { seq: request.seq, enabled: true, counts: {} }
      : {},
  );
  await type(box, "hello");
  expect(badge().dot.className).toBe("dot clean");

  box.value = "hello there";
  box.dispatchEvent(new Event("input"));
  expect(badge().dot.className).toBe("dot checking");
  await vi.advanceTimersByTimeAsync(400);
  expect(badge().dot.className).toBe("dot clean");
});

test("shows the dots over a red count while typing, then the new count", async () => {
  const box = await start(async (request) =>
    request.type === "scan"
      ? {
          seq: request.seq,
          enabled: true,
          counts: request.text.includes("@") ? { EMAIL: 1 } : {},
        }
      : {},
  );
  await type(box, "jane@example.com");
  expect(badge().dot.className).toBe("dot found");

  box.value = "jane@example.com and";
  box.dispatchEvent(new Event("input"));
  expect(badge().dot.className).toBe("dot checking");
  expect(badge().dot.querySelectorAll(".dots i")).toHaveLength(3);
  await vi.advanceTimersByTimeAsync(400);
  expect(badge().dot.className).toBe("dot found");
  expect(badge().dot.textContent).toBe("1");
});

test("settles when the text changes back before the scan", async () => {
  const box = await start(async (request) =>
    request.type === "scan"
      ? { seq: request.seq, enabled: true, counts: {} }
      : {},
  );
  await type(box, "hello");
  box.value = "hello!";
  box.dispatchEvent(new Event("input"));
  box.value = "hello";
  box.dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(400);
  expect(badge().dot.className).toBe("dot clean");
});

test("ignores an answer about text that has since changed", async () => {
  const answers: (() => void)[] = [];
  const box = await start((request) =>
    request.type === "scan"
      ? new Promise((resolve) => {
          answers.push(() =>
            resolve({ seq: request.seq, enabled: true, counts: {} }),
          );
        })
      : Promise.resolve({}),
  );
  await type(box, "hello");
  box.value = "hello there";
  box.dispatchEvent(new Event("input"));
  answers[0]();
  await vi.advanceTimersByTimeAsync(0);
  expect(badge().dot.className).toBe("dot checking");
});

test("rechecks unchanged drafts on committed behavior and rule changes", async () => {
  let flagged = 0;
  let scans = 0;
  const box = await start(async (request) => {
    if (request.type !== "scan") return {};
    scans++;
    return {
      seq: request.seq,
      enabled: true,
      counts: flagged ? { DENYLIST: flagged } : {},
    };
  });
  await type(box, "notes on Project Atlas");
  expect(badge().dot.className).toBe("dot clean");
  const before = scans;

  storageListener(
    {
      settings: {
        oldValue: { blockSends: false },
        newValue: { blockSends: true },
      },
    },
    "local",
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(scans).toBe(before + 1);

  flagged = 1;
  storageListener(
    {
      settings: {
        oldValue: { denylist: [] },
        newValue: { denylist: ["Project Atlas"] },
      },
    },
    "local",
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(scans).toBe(before + 2);
  expect(badge().dot.className).toBe("dot found");
  expect(badge().dot.textContent).toBe("1");
});

test("checks the chat box again when the service worker asks", async () => {
  let skipped = false;
  const box = await start(async (request) =>
    request.type === "scan"
      ? {
          seq: request.seq,
          enabled: true,
          counts: skipped ? {} : { PERSON: 1 },
        }
      : {},
  );
  await type(box, "met Ann today");
  expect(badge().dot.className).toBe("dot found");

  // Ann was just marked not sensitive in the side panel
  skipped = true;
  await fromWorker({ type: "recheck" });
  await vi.advanceTimersByTimeAsync(0);
  expect(badge().dot.className).toBe("dot clean");
});

test("greys out the badge, and checks nothing, while checking is off", async () => {
  const sent: string[] = [];
  const box = await start(
    async (request) => {
      sent.push(request.type);
      return {};
    },
    PAGE,
    false,
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(badge().dot.className).toBe("dot off");
  expect(badge().dot.title).toBe(OFF_TITLE);

  box.value = "jane@example.com";
  box.dispatchEvent(new Event("input"));
  expect(badge().dot.className).toBe("dot off");
  await vi.advanceTimersByTimeAsync(400);
  expect(badge().dot.className).toBe("dot off");
  expect(sent).not.toContain("scan");
});

test("greys out the badge and closes its panel as soon as checking is turned off", async () => {
  const box = await start(async (request) =>
    request.type === "scan"
      ? { seq: request.seq, enabled: true, counts: { EMAIL: 1 } }
      : {},
  );
  await type(box, "jane@example.com");
  badge().dot.click();
  const panel = document
    .querySelector("datafog-badge")!
    .shadowRoot!.querySelector<HTMLElement>(".panel")!;
  expect(panel.hidden).toBe(false);

  await setChecking(false);
  expect(badge().dot.className).toBe("dot off");
  expect(panel.hidden).toBe(true);

  await setChecking(true);
  expect(badge().dot.className).toBe("dot found");
});

test("anchors the badge to the form, not the editor inside it", async () => {
  vi.spyOn(HTMLFormElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 100, y: 400, width: 800, height: 52 }),
  );
  await start(async () => ({}));
  await vi.advanceTimersByTimeAsync(20);
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  const wrap = root.querySelector<HTMLElement>(".wrap")!;
  // Level with the form's bottom edge, at ChatGPT's fixed size
  expect(wrap.style.bottom).toBe("316px");
  expect(wrap.style.getPropertyValue("--size")).toBe("56px");
});

/**
 * Click a button in the badge's panel and let the rescan finish.
 *
 * @param name The button's class.
 */
async function press(name: string): Promise<void> {
  panelButton(name).click();
  await vi.advanceTimersByTimeAsync(400);
}

/**
 * Find a button in the badge's panel.
 *
 * @param name The button's class.
 * @returns The button.
 */
function panelButton(name: string): HTMLButtonElement {
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  return root.querySelector<HTMLButtonElement>(`.${name}`)!;
}

/**
 * Answer scans and redactions as Core would for two emails.
 *
 * @param request The request.
 * @returns The response.
 */
async function coreForTwoEmails(request: Request): Promise<unknown> {
  if (request.type === "scan") {
    const found = request.text.includes("@");
    return {
      seq: request.seq,
      enabled: true,
      counts: found ? { EMAIL: 2 } : {},
    };
  }
  if (request.type !== "redact") return {};
  const edits = ["jane@example.com", "al@example.org"].map((value) => {
    const at = request.text.indexOf(value);
    return { start: at, end: at + value.length, replacement: "[EMAIL]" };
  });
  return {
    text: request.text
      .replace("jane@example.com", "[EMAIL]")
      .replace("al@example.org", "[EMAIL]"),
    edits,
  };
}

const TWO_EMAILS = "Ask jane@example.com or al@example.org today";
const REDACTED = "Ask [EMAIL] or [EMAIL] today";

test("undoes and redoes a redaction from the panel", async () => {
  const box = await start(coreForTwoEmails);
  await type(box, TWO_EMAILS);
  expect(panelButton("undo").disabled).toBe(true);

  await press("redact");
  expect(box.value).toBe(REDACTED);
  expect(badge().dot.className).toBe("dot clean");
  expect(panelButton("undo").disabled).toBe(false);
  expect(panelButton("redo").disabled).toBe(true);

  await press("undo");
  expect(box.value).toBe(TWO_EMAILS);
  expect(badge().dot.className).toBe("dot found");
  expect(panelButton("undo").disabled).toBe(true);
  expect(panelButton("redo").disabled).toBe(false);

  await press("redo");
  expect(box.value).toBe(REDACTED);
  expect(panelButton("undo").disabled).toBe(false);
});

test("editing even line breaks invalidates Undo and Redo", async () => {
  const box = await start(coreForTwoEmails);
  await type(box, TWO_EMAILS);
  await press("redact");
  await type(box, REDACTED.replace("or ", "or\n"));
  expect(panelButton("undo").disabled).toBe(true);
  expect(panelButton("redo").disabled).toBe(true);
});

test("undoes a rich-text redaction with one edit per value", async () => {
  const exec = stubEditing();
  await start(
    coreForTwoEmails,
    `<form><div id="prompt-textarea" contenteditable="true"><p>${TWO_EMAILS}</p></div></form>`,
  );
  const box = document.querySelector<HTMLElement>("#prompt-textarea")!;
  box.dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(400);
  await press("redact");
  exec.mockClear();

  await press("undo");

  expect(box.textContent).toBe(TWO_EMAILS);
  expect(exec).not.toHaveBeenCalledWith("selectAll");
});

test("undoes in place when the editor redraws line breaks", async () => {
  const exec = stubEditing();
  await start(
    coreForTwoEmails,
    `<form><div id="prompt-textarea" contenteditable="true"><p>${TWO_EMAILS}</p></div></form>`,
  );
  const box = document.querySelector<HTMLElement>("#prompt-textarea")!;
  box.dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(400);
  await press("redact");
  // As ChatGPT's editor does around a link, innerText loses a line break
  const read = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "innerText",
  );
  vi.spyOn(box, "innerText", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return read!.get!.call(this).replace("or ", "or\n");
  });
  exec.mockClear();

  await press("undo");

  expect(box.textContent).toBe(TWO_EMAILS);
  expect(exec).not.toHaveBeenCalledWith("selectAll");
});

test("stops offering undo once the text changes", async () => {
  const box = await start(coreForTwoEmails);
  await type(box, TWO_EMAILS);
  await press("redact");

  await type(box, `${REDACTED}!`);

  expect(panelButton("undo").disabled).toBe(true);
  expect(panelButton("redo").disabled).toBe(true);
});

/**
 * Send a request from the service worker to the content script.
 *
 * @param request The request.
 * @returns The content script's response.
 */
function fromWorker(request: TabRequest): Promise<unknown> {
  return new Promise((resolve) => tabListener(request, {}, resolve));
}

const MARKED = "Ask [[EMAIL_7KQ4ZM]] or [[EMAIL_N3PX2D]] today";

/**
 * The edits an approved review makes to the two emails.
 *
 * @returns The marked text and its edits.
 */
function markers(): RedactResponse {
  const values = [
    ["jane@example.com", "[[EMAIL_7KQ4ZM]]"],
    ["al@example.org", "[[EMAIL_N3PX2D]]"],
  ];
  return {
    text: MARKED,
    edits: values.map(([value, replacement]) => {
      const at = TWO_EMAILS.indexOf(value);
      return { start: at, end: at + value.length, replacement };
    }),
  };
}

test("asks for a review in the side panel when Pseudonymize is clicked", async () => {
  const box = await start(coreForTwoEmails);
  await type(box, TWO_EMAILS);

  await press("pseudonymize");

  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: "pseudonymize",
    text: TWO_EMAILS,
  });
  expect(box.value).toBe(TWO_EMAILS);
});

test("shows a failure when Pseudonymize can't be asked for", async () => {
  const box = await start(async (request) =>
    request.type === "pseudonymize"
      ? { error: "no_response" }
      : coreForTwoEmails(request),
  );
  await type(box, TWO_EMAILS);

  await press("pseudonymize");

  expect(
    document
      .querySelector("datafog-badge")!
      .shadowRoot!.querySelector(".progress")!.textContent,
  ).toContain("draft is unchanged");
});

test("tells the service worker what's in the chat box", async () => {
  const box = await start(coreForTwoEmails);
  await type(box, TWO_EMAILS);

  expect(await fromWorker({ type: "chat-text" })).toEqual({
    text: TWO_EMAILS,
  });
});

test("puts approved markers in the chat box, and can undo them", async () => {
  const box = await start(coreForTwoEmails);
  await type(box, TWO_EMAILS);

  expect(
    await fromWorker({
      type: "apply-pseudonyms",
      before: TWO_EMAILS,
      response: markers(),
    }),
  ).toEqual({});
  await vi.advanceTimersByTimeAsync(400);
  expect(box.value).toBe(MARKED);
  expect(badge().dot.className).toBe("dot clean");

  await press("undo");
  expect(box.value).toBe(TWO_EMAILS);
});

test("leaves the chat box alone when it changed since the review", async () => {
  const box = await start(coreForTwoEmails);
  await type(box, `${TWO_EMAILS}!`);

  expect(
    await fromWorker({
      type: "apply-pseudonyms",
      before: TWO_EMAILS,
      response: markers(),
    }),
  ).toEqual({ error: "chat_box_changed" });
  expect(box.value).toBe(`${TWO_EMAILS}!`);
});

test("keeps the panel open through Undo and Redo, until a click elsewhere", async () => {
  const box = await start(coreForTwoEmails);
  await type(box, TWO_EMAILS);
  await press("redact");
  badge().dot.click();
  const panel = document
    .querySelector("datafog-badge")!
    .shadowRoot!.querySelector<HTMLElement>(".panel")!;
  expect(panel.hidden).toBe(false);

  await press("undo");
  expect(panel.hidden).toBe(false);
  await press("redo");
  expect(panel.hidden).toBe(false);
  expect(box.value).toBe(REDACTED);

  document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(panel.hidden).toBe(true);
});

test("ignores Undo when the text changed since the last scan", async () => {
  const box = await start(coreForTwoEmails);
  await type(box, TWO_EMAILS);
  await press("redact");

  box.value = `${REDACTED}!`;
  await press("undo");

  expect(box.value).toBe(`${REDACTED}!`);
});

test("warns about an attached file until the message is sent", async () => {
  const box = await start(async () => ({}));
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  const warning = root.querySelector<HTMLElement>(".files")!;
  const panel = root.querySelector<HTMLElement>(".panel")!;
  expect(warning.hidden).toBe(true);

  const input = document.createElement("input");
  input.type = "file";
  box.after(input);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  expect(warning.hidden).toBe(false);
  expect(panel.hidden).toBe(false);

  box.dispatchEvent(
    Object.assign(new Event("keydown", { bubbles: true }), { key: "Enter" }),
  );
  expect(warning.hidden).toBe(true);
  expect(panel.hidden).toBe(true);
});

const SEND_PAGE =
  '<form><textarea id="prompt-textarea"></textarea><button id="go" type="submit"></button></form>';

/**
 * Load the content script with send blocking on and a stubbed scan result.
 *
 * @param scan What each scan answers, or a promise of it.
 * @returns The chat box and a count of clicks reaching the send button.
 */
async function startBlocking(
  scan: () => object | Promise<object>,
): Promise<{ box: HTMLTextAreaElement; sent: ReturnType<typeof vi.fn> }> {
  const box = await start(async (request) => {
    if (request.type === "block-sends") return { blockSends: true };
    if (request.type !== "scan") return {};
    return { seq: request.seq, blockSends: true, ...(await scan()) };
  }, SEND_PAGE);
  await vi.advanceTimersByTimeAsync(0);
  const sent = vi.fn((event: Event) => event.preventDefault());
  document.querySelector("#go")!.addEventListener("click", sent);
  return { box, sent };
}

/**
 * Press Enter in the chat box.
 *
 * @param box The chat box.
 * @param repeat Whether the key is being held down.
 * @returns True if the press got through to the page.
 */
function pressEnter(box: HTMLElement, repeat = false): boolean {
  return box.dispatchEvent(
    Object.assign(new Event("keydown", { bubbles: true, cancelable: true }), {
      key: "Enter",
      repeat,
    }),
  );
}

const FOUND = { enabled: true, counts: { EMAIL: 1 } };
const CLEAN = { enabled: true, counts: {} };

test("lets a send through when blocking is off", async () => {
  const box = await start(async (request) =>
    request.type === "scan"
      ? { seq: request.seq, blockSends: false, ...FOUND }
      : {},
  );
  await type(box, "jane@example.com");
  expect(pressEnter(box)).toBe(true);
});

test("holds the first Enter, and a second sends anyway", async () => {
  const { box } = await startBlocking(() => FOUND);
  await type(box, "jane@example.com");

  expect(pressEnter(box)).toBe(false);
  expect(panelButton("send").hidden).toBe(false);

  expect(pressEnter(box)).toBe(true);
  expect(panelButton("send").hidden).toBe(true);
});

test("sends anyway on a quick double Enter, before the scan answers", async () => {
  const { box, sent } = await startBlocking(() => FOUND);
  box.value = "jane@example.com";
  box.dispatchEvent(new Event("input"));

  expect(pressEnter(box)).toBe(false);
  expect(pressEnter(box)).toBe(false);
  await vi.advanceTimersByTimeAsync(0);

  expect(sent).toHaveBeenCalledOnce();
});

test("doesn't treat a held-down Enter as a second press", async () => {
  const { box } = await startBlocking(() => FOUND);
  await type(box, "jane@example.com");

  expect(pressEnter(box)).toBe(false);
  expect(pressEnter(box, true)).toBe(false);
});

test("sends after the scan when the text turns out clean", async () => {
  const { box, sent } = await startBlocking(() => CLEAN);
  box.value = "hello";
  box.dispatchEvent(new Event("input"));

  expect(pressEnter(box)).toBe(false);
  await vi.advanceTimersByTimeAsync(0);

  expect(sent).toHaveBeenCalledOnce();
});

test("warns after the scan when the text has a value", async () => {
  const { box, sent } = await startBlocking(() => FOUND);
  box.value = "jane@example.com";
  box.dispatchEvent(new Event("input"));

  pressEnter(box);
  await vi.advanceTimersByTimeAsync(0);

  expect(sent).not.toHaveBeenCalled();
  expect(panelButton("send").hidden).toBe(false);
});

test("sends with the Send anyway button", async () => {
  const { box, sent } = await startBlocking(() => FOUND);
  await type(box, "jane@example.com");
  pressEnter(box);

  panelButton("send").click();

  expect(sent).toHaveBeenCalledOnce();
  expect(panelButton("send").hidden).toBe(true);
});

test("lets a send through after Dismiss", async () => {
  const { box } = await startBlocking(() => FOUND);
  await type(box, "jane@example.com");
  pressEnter(box);

  panelButton("dismiss").click();

  expect(pressEnter(box)).toBe(true);
});

test("warns again once the text changes", async () => {
  const { box } = await startBlocking(() => FOUND);
  await type(box, "jane@example.com");
  pressEnter(box);

  await type(box, "jane@example.org");

  expect(pressEnter(box)).toBe(false);
});

test("stays held after a failed scan, until Send anyway", async () => {
  const { box, sent } = await startBlocking(() => ({
    error: "datafog_failed",
  }));
  await type(box, "jane@example.com");

  expect(pressEnter(box)).toBe(false);
  expect(pressEnter(box)).toBe(false);
  expect(pressEnter(box)).toBe(false);

  panelButton("send").click();
  expect(sent).toHaveBeenCalledOnce();
  expect(pressEnter(box)).toBe(true);
});

test("offers Send anyway when a scan never answers", async () => {
  const { box } = await startBlocking(() => new Promise<object>(() => {}));
  box.value = "hello";
  box.dispatchEvent(new Event("input"));

  pressEnter(box);
  expect(panelButton("send").hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(3000);

  expect(badge().dot.className).toBe("dot failed");
  expect(panelButton("send").hidden).toBe(false);
});

test("reads the latest answer for restore", async () => {
  await start(
    async () => ({}),
    `${PAGE}
    <div data-message-author-role="assistant">First</div>
    <div data-message-author-role="user">[[EMAIL_7KQ4ZM]]</div>
    <div data-message-author-role="assistant">Write to [[EMAIL_7KQ4ZM]]</div>`,
  );

  expect(await fromWorker({ type: "latest-answer" })).toEqual({
    text: "Write to [[EMAIL_7KQ4ZM]]",
  });
});

test("says when there's no answer yet", async () => {
  await start(async () => ({}));

  expect(await fromWorker({ type: "latest-answer" })).toEqual({ text: null });
});

test("falls back to the last text with a marker, outside the chat box", async () => {
  const box = await start(
    async () => ({}),
    `<main>
      <section><p>Earlier: [[EMAIL_N3PX2D]]</p></section>
      <section><p>Write to [[EMAIL_7KQ4ZM]] today</p></section>
    </main>${PAGE}`,
  );
  box.value = "Draft for [[EMAIL_ZZZZZZ]]";

  expect(await fromWorker({ type: "latest-answer" })).toEqual({
    text: "Write to [[EMAIL_7KQ4ZM]] today",
  });
});

test("reads the latest answer from ChatGPT's response containers", async () => {
  await start(
    async () => ({}),
    `<main>
      <div data-user-message-bubble>Ask [[EMAIL_7KQ4ZM]]</div>
      <div data-dil-response>First answer</div>
      <div data-user-message-bubble>And again</div>
      <div data-dil-response><p>Write to [[EMAIL_7KQ4ZM]]</p></div>
    </main>${PAGE}`,
  );

  expect(await fromWorker({ type: "latest-answer" })).toEqual({
    text: "Write to [[EMAIL_7KQ4ZM]]",
  });
});

test("shows the original values in the latest answer, and hides them", async () => {
  await start(
    async () => ({}),
    `<main>
      <div data-dil-response><p>Old [[EMAIL_7KQ4ZM]]</p></div>
      <div data-dil-response><p>Write to [[EMAIL_7KQ4ZM]]</p></div>
    </main>${PAGE}`,
  );
  const [older, latest] = document.querySelectorAll("[data-dil-response]");
  const values = [{ marker: "[[EMAIL_7KQ4ZM]]", original: "jane@example.com" }];

  expect(await fromWorker({ type: "show-originals", values })).toEqual({
    shown: 1,
  });
  expect(document.querySelector("datafog-original")).not.toBeNull();
  expect(latest.textContent).toContain("[[EMAIL_");
  expect(older.querySelector("datafog-original")).toBeNull();

  await fromWorker({ type: "hide-originals" });
  expect(latest.textContent).toBe("Write to [[EMAIL_7KQ4ZM]]");
});

test("reads the markers under shown values, so Restore works again", async () => {
  await start(
    async () => ({}),
    `<main><div data-dil-response><p>Write to [[EMAIL_7KQ4ZM]]</p></div></main>${PAGE}`,
  );
  const values = [{ marker: "[[EMAIL_7KQ4ZM]]", original: "jane@example.com" }];
  await fromWorker({ type: "show-originals", values });

  expect(await fromWorker({ type: "latest-answer" })).toEqual({
    text: "Write to [[EMAIL_7KQ4ZM]]",
  });
  expect(await fromWorker({ type: "show-originals", values })).toEqual({
    shown: 1,
  });
});

test("circle More opens the independent sidebar and there is no floating tab", async () => {
  await start(async () => ({}));
  expect(document.querySelector("datafog-tab")).toBeNull();
  badge().dot.click();
  await press("more-toggle");
  await press("sidebar");
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: "open-panel",
  });
});

test("Replace waits for confirmed encrypted save and preserves a newer draft even if text returns", async () => {
  let finish!: (response: object) => void;
  const box = await start(async (request) =>
    request.type === "pseudonymize"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : coreForTwoEmails(request),
  );
  await type(box, TWO_EMAILS);
  panelButton("pseudonymize").click();
  await vi.advanceTimersByTimeAsync(0);
  expect(box.value).toBe(TWO_EMAILS);
  expect(
    document
      .querySelector("datafog-badge")!
      .shadowRoot!.querySelector(".progress")!.textContent,
  ).toContain("Saving originals");
  await type(box, "new draft");
  await type(box, TWO_EMAILS);
  finish({ text: "[[EMAIL_A]]", edits: [], saved: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(box.value).toBe(TWO_EMAILS);
  expect(panelButton("undo").disabled).toBe(true);
});

test("Replace applies a confirmed save locally and supports valid Undo/Redo", async () => {
  const box = await start(async (request) =>
    request.type === "pseudonymize"
      ? {
          text: "[[EMAIL_A]]",
          edits: [
            { start: 0, end: request.text.length, replacement: "[[EMAIL_A]]" },
          ],
          saved: true,
        }
      : coreForTwoEmails(request),
  );
  await type(box, "jane@example.com");
  await press("pseudonymize");
  expect(box.value).toBe("[[EMAIL_A]]");
  expect(panelButton("undo").disabled).toBe(false);
  await press("undo");
  expect(box.value).toBe("jane@example.com");
  await press("redo");
  expect(box.value).toBe("[[EMAIL_A]]");
});

test("an unconfirmed encrypted save leaves the draft unchanged", async () => {
  const box = await start(async (request) =>
    request.type === "pseudonymize"
      ? { text: "[[EMAIL_A]]", edits: [] }
      : coreForTwoEmails(request),
  );
  await type(box, "jane@example.com");
  await press("pseudonymize");
  expect(box.value).toBe("jane@example.com");
  expect(
    document
      .querySelector("datafog-badge")!
      .shadowRoot!.querySelector(".progress")!.textContent,
  ).toContain("could not be confirmed");
});

test("policy notices reject a completed scan carrying the previous policy token", async () => {
  let version = "old";
  const box = await start(async (request) =>
    request.type === "scan"
      ? { seq: request.seq, enabled: true, counts: {}, policyVersion: version }
      : {},
  );
  await type(box, "jane@example.com");
  expect(badge().dot.className).toBe("dot clean");
  await fromWorker({ type: "recheck", policyVersion: "new" });
  await vi.advanceTimersByTimeAsync(0);
  expect(badge().dot.className).toBe("dot checking");
  version = "new";
  await fromWorker({ type: "recheck", policyVersion: "new" });
  await vi.advanceTimersByTimeAsync(0);
  expect(badge().dot.className).toBe("dot clean");
});

test("reports a saved mapping separately when the editor rejects application", async () => {
  const box = await start(async (request) =>
    request.type === "pseudonymize"
      ? { text: "[[EMAIL_A]]", edits: [], saved: true }
      : coreForTwoEmails(request),
  );
  await type(box, "jane@example.com");
  vi.spyOn(HTMLTextAreaElement.prototype, "value", "set").mockImplementation(
    () => {},
  );
  await press("pseudonymize");
  expect(box.value).toBe("jane@example.com");
  expect(
    document
      .querySelector("datafog-badge")!
      .shadowRoot!.querySelector(".progress")!.textContent,
  ).toContain("Originals saved, but the editor did not accept");
  expect(panelButton("undo").disabled).toBe(true);
});

test("unavailable settings never report a clean draft and Retry checks encrypted access", async () => {
  const box = await start(coreForTwoEmails);
  await type(box, "ordinary words");
  settingsFailure = true;
  await fromWorker({ type: "recheck" });
  await vi.advanceTimersByTimeAsync(0);
  expect(badge().dot.className).toBe("dot failed");
  settingsFailure = false;
  await press("retry");
  expect(badge().dot.className).toBe("dot clean");
});

test("Replace sends the accepted scan reservation and refreshes an expired preview before retry", async () => {
  let scans = 0;
  let replacements = 0;
  const box = await start(async (request) => {
    if (request.type === "scan") {
      scans++;
      return {
        seq: request.seq,
        enabled: true,
        counts: request.text.includes("@") ? { EMAIL: 1 } : {},
        findings: request.text.includes("@")
          ? [
              {
                entityType: "EMAIL",
                original: request.text,
                marker: scans === 1 ? "[[EMAIL_FIRST]]" : "[[EMAIL_FRESH]]",
              },
            ]
          : [],
        previewId: scans === 1 ? "reservation-first" : "reservation-fresh",
      };
    }
    if (request.type === "pseudonymize") {
      replacements++;
      if (replacements === 1) {
        expect(request.previewId).toBe("reservation-first");
        return { error: "preview_expired" };
      }
      expect(request.previewId).toBe("reservation-fresh");
      return { text: "[[EMAIL_FRESH]]", edits: [], saved: true };
    }
    return {};
  });
  await type(box, "jane@example.com");
  await press("pseudonymize");
  expect(box.value).toBe("jane@example.com");
  expect(replacements).toBe(1);
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  expect(root.querySelector(".preview")!.textContent).toContain(
    "[[EMAIL_FRESH]]",
  );
  expect(root.querySelector(".progress")!.textContent).toContain(
    "preview expired",
  );
  expect(panelButton("pseudonymize").disabled).toBe(false);
  await press("pseudonymize");
  expect(box.value).toBe("[[EMAIL_FRESH]]");
});

const CHOOSABLE = [
  {
    entityType: "EMAIL",
    original: "jane@example.com",
    marker: "[[EMAIL_A]]",
    start: 0,
    end: 16,
  },
  {
    entityType: "EMAIL",
    original: "john@example.com",
    marker: "[[EMAIL_B]]",
    start: 17,
    end: 33,
  },
];
function choices(): NodeListOf<HTMLButtonElement> {
  return document
    .querySelector("datafog-badge")!
    .shadowRoot!.querySelectorAll<HTMLButtonElement>(".choose");
}
function selectionReply(request: Request): unknown {
  if (request.type !== "scan" && request.type !== "select") return {};
  return {
    seq: request.seq,
    enabled: true,
    counts: { EMAIL: 2 },
    blockSends: true,
    previewId: request.type === "select" ? "chosen" : "initial",
    findings: CHOOSABLE.map((item) => ({
      ...item,
      kept: request.keep?.some((place) => place.start === item.start) ?? false,
      marker: request.keep?.some((place) => place.start === item.start)
        ? ""
        : "[[EMAIL_NEW]]",
    })),
  };
}
test("selection shows exact refreshed tokens, preserves choices on recheck and resets on edit", async () => {
  const box = await start(async (request) => selectionReply(request));
  await type(box, "jane@example.com john@example.com");
  choices()[1].focus();
  choices()[1].click();
  await vi.advanceTimersByTimeAsync(0);
  expect(choices()[1].getAttribute("aria-checked")).toBe("false");
  expect(panelButton("pseudonymize").textContent).toBe("Replace 1");
  expect(
    document.querySelector("datafog-badge")!.shadowRoot!.activeElement,
  ).toBe(choices()[1]);
  await fromWorker({ type: "recheck" });
  await vi.advanceTimersByTimeAsync(0);
  expect(choices()[1].getAttribute("aria-checked")).toBe("false");
  await type(box, "jane@example.com john@example.com!");
  expect(choices()[1].getAttribute("aria-checked")).toBe("true");
});
test("Redact only sends kept occurrence ranges and allow only saves skipped typed values", async () => {
  const seen: Request[] = [];
  const box = await start(async (request) => {
    seen.push(request);
    if (request.type === "redact") return { error: "test_failure" };
    return selectionReply(request);
  });
  await type(box, "jane@example.com john@example.com");
  choices()[1].click();
  await vi.advanceTimersByTimeAsync(0);
  await press("redact");
  expect(seen).toContainEqual({
    type: "redact",
    text: "jane@example.com john@example.com",
    keep: [{ start: 17, end: 33 }],
  });
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  root.querySelector<HTMLButtonElement>(".allow")!.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(seen.filter((request) => request.type === "always-allow")).toEqual([
    { type: "always-allow", entityType: "EMAIL", value: "john@example.com" },
  ]);
});
test("late selection response cannot restore a stale draft's checkbox choices or preview", async () => {
  let resolve!: (value: unknown) => void;
  const box = await start(async (request) =>
    request.type === "select"
      ? new Promise((done) => {
          resolve = done;
        })
      : selectionReply(request),
  );
  await type(box, "jane@example.com john@example.com");
  choices()[1].click();
  await type(box, "new draft");
  resolve({
    seq: 0,
    enabled: true,
    counts: { EMAIL: 2 },
    findings: CHOOSABLE.map((item) => ({ ...item, kept: true })),
    previewId: "stale",
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(box.value).toBe("new draft");
  expect(choices()[0].getAttribute("aria-checked")).toBe("true");
  expect(panelButton("pseudonymize").textContent).toBe("Replace");
});

test("failed selection refreshes intended skips and disables both transforms when all are skipped", async () => {
  let fail = true;
  const box = await start(async (request) => {
    if (request.type === "select" && fail) {
      fail = false;
      return { error: "preview_expired" };
    }
    return selectionReply(request);
  });
  await type(box, "jane@example.com john@example.com");
  choices()[0].click();
  await vi.advanceTimersByTimeAsync(0);
  expect(choices()[0].getAttribute("aria-checked")).toBe("false");
  expect(
    document
      .querySelector("datafog-badge")!
      .shadowRoot!.querySelector(".progress")!.textContent,
  ).toContain("preview was refreshed");
  choices()[1].click();
  await vi.advanceTimersByTimeAsync(0);
  expect(panelButton("pseudonymize").disabled).toBe(true);
  expect(panelButton("redact").disabled).toBe(true);
  expect(panelButton("pseudonymize").textContent).toBe("Replace 0");
  choices()[0].click();
  await vi.advanceTimersByTimeAsync(0);
  expect(panelButton("pseudonymize").disabled).toBe(false);
  expect(panelButton("pseudonymize").textContent).toBe("Replace 1");
});
