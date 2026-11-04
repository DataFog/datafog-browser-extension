// @vitest-environment happy-dom
/**
 * Which page events count as a send or an attached file.
 */

import { beforeAll, beforeEach, expect, test, vi } from "vitest";

import { watchPage } from "./page";

const send = vi.fn();
const files = vi.fn();

/**
 * Dispatch an event carrying extra fields, as happy-dom's constructors drop
 * clipboard and drag data.
 *
 * @param target Where the event starts.
 * @param type The event's type.
 * @param fields The extra fields.
 */
function fire(
  target: EventTarget,
  type: string,
  fields: Record<string, unknown> = {},
): void {
  target.dispatchEvent(
    Object.assign(new Event(type, { bubbles: true }), fields),
  );
}

beforeAll(() => {
  watchPage(() => document.querySelector("textarea"), { send, files });
});

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = `
    <form id="chat">
      <textarea></textarea>
      <input type="file" />
      <button id="plus" type="button"></button>
      <button id="go" type="submit"></button>
    </form>
    <form id="other"><button id="elsewhere" type="submit"></button></form>`;
});

test("counts the send button, but not other buttons", () => {
  document.querySelector<HTMLElement>("#plus")!.click();
  document.querySelector<HTMLElement>("#elsewhere")!.click();
  expect(send).not.toHaveBeenCalled();

  document.querySelector<HTMLElement>("#go")!.click();
  expect(send).toHaveBeenCalled();
});

test("counts Enter, but not a new line or composing text", () => {
  const box = document.querySelector("textarea")!;
  fire(box, "keydown", { key: "Enter", shiftKey: true });
  fire(box, "keydown", { key: "Enter", isComposing: true });
  fire(box, "keydown", { key: "a" });
  expect(send).not.toHaveBeenCalled();

  fire(box, "keydown", { key: "Enter" });
  expect(send).toHaveBeenCalledOnce();
});

test("counts the chat form's submit, but not another form's", () => {
  fire(document.querySelector("#other")!, "submit");
  expect(send).not.toHaveBeenCalled();

  fire(document.querySelector("#chat")!, "submit");
  expect(send).toHaveBeenCalledOnce();
});

test("counts a chosen file", () => {
  fire(document.querySelector("textarea")!, "change");
  expect(files).not.toHaveBeenCalled();

  fire(document.querySelector('input[type="file"]')!, "change");
  expect(files).toHaveBeenCalledOnce();
});

test("counts a pasted file, but not pasted text", () => {
  const box = document.querySelector("textarea")!;
  fire(box, "paste", { clipboardData: { files: [] } });
  expect(files).not.toHaveBeenCalled();

  fire(box, "paste", { clipboardData: { files: [{}] } });
  expect(files).toHaveBeenCalledOnce();
});

test("counts a dropped file, but not dragged text", () => {
  fire(document.body, "drop", { dataTransfer: { types: ["text/plain"] } });
  expect(files).not.toHaveBeenCalled();

  fire(document.body, "drop", { dataTransfer: { types: ["Files"] } });
  expect(files).toHaveBeenCalledOnce();
});
