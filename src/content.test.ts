// @vitest-environment happy-dom
/**
 * The content script's badge when the service worker answers, fails, or is
 * gone.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { Request } from "./messages";

type Reply = (request: Request) => Promise<unknown>;

const PAGE = '<form><textarea id="prompt-textarea"></textarea></form>';

/**
 * Load a fresh content script against a page with a chat box.
 *
 * @param reply How the stubbed service worker answers each request.
 * @param page The page's markup; its last textarea is the visible chat box.
 * @returns The visible chat box.
 */
async function start(reply: Reply, page = PAGE): Promise<HTMLTextAreaElement> {
  document.body.innerHTML = page;
  Object.assign(globalThis, {
    chrome: { runtime: { sendMessage: vi.fn(reply) } },
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

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
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
  expect(badge().title).toBe("DataFog couldn't check this text");
});

test("asks for a page reload when the extension was updated", async () => {
  const box = await start(async (request) => {
    if (request.type === "scan")
      throw new Error("Extension context invalidated");
    return {};
  });
  await type(box, "jane@example.com");
  expect(badge().dot.className).toBe("dot failed");
  expect(badge().title).toBe("DataFog was updated");
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  expect(root.querySelector(".note")!.textContent).toBe(
    "Reload this page to keep checking this chat box.",
  );
});

test("shows a failure when Redact errors", async () => {
  const box = await start(async (request) => {
    if (request.type === "scan")
      return { seq: request.seq, enabled: true, counts: { EMAIL: 1 } };
    return request.type === "redact" ? { error: "review_conflict" } : {};
  });
  await type(box, "jane@example.com");
  const root = document.querySelector("datafog-badge")!.shadowRoot!;
  root.querySelector<HTMLButtonElement>(".redact")!.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(badge().dot.className).toBe("dot failed");
  expect(box.value).toBe("jane@example.com");
});

test("asks for the side panel when the page tab is clicked", async () => {
  await start(async () => ({}));
  const tab = document.querySelector("datafog-tab")!.shadowRoot!;
  tab.querySelector<HTMLButtonElement>("button")!.click();
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: "open-panel",
  });
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
      range.deleteContents();
      range.insertNode(document.createTextNode(value ?? ""));
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
 * @returns The chat box.
 */
async function redactRichText(lines: string[]): Promise<HTMLElement> {
  const value = "jane@example.com";
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
