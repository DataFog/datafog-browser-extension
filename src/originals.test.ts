// @vitest-environment happy-dom
/**
 * Original values shown in place of markers in an answer, and put back.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { hideOriginals, showOriginals } from "./originals";

const VALUES = [
  { marker: "[[EMAIL_7KQ4ZM]]", original: "jane@example.com" },
  { marker: "[[EMAIL_N3PX2D]]", original: "<b>al@example.org</b>" },
];

/**
 * Put an answer on the page.
 *
 * @param markup The answer's markup.
 * @returns The answer.
 */
function answer(markup: string): HTMLElement {
  document.body.innerHTML = `<div id="answer">${markup}</div>`;
  return document.querySelector<HTMLElement>("#answer")!;
}

/**
 * The values on screen, read through their shadow roots.
 *
 * @param element The answer.
 * @returns Each value's text.
 */
function shown(element: Element): string[] {
  return Array.from(
    element.querySelectorAll("datafog-original"),
    (host) => host.shadowRoot!.querySelector("span")!.textContent ?? "",
  );
}

beforeEach(() => {
  // The value's shadow root is closed; open it so the test can see it
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
  hideOriginals();
  vi.restoreAllMocks();
});

test("shows each value in place of its marker, as text", () => {
  const element = answer(
    "<p>Email [[EMAIL_7KQ4ZM]], then [[EMAIL_N3PX2D]].</p><ul><li>[[EMAIL_7KQ4ZM]]</li></ul>",
  );

  expect(showOriginals(element, VALUES)).toBe(3);

  expect(shown(element)).toEqual([
    "jane@example.com",
    "<b>al@example.org</b>",
    "jane@example.com",
  ]);
  expect(element.querySelector("b")).toBeNull();
  // The page's own text still has only markers
  expect(element.textContent).toBe("Email , then .");
});

test("leaves markers it has no value for", () => {
  const element = answer("<p>[[EMAIL_7KQ4ZM]] and [[EMAIL_ZZZZZZ]]</p>");

  expect(showOriginals(element, VALUES)).toBe(1);

  expect(element.textContent).toBe(" and [[EMAIL_ZZZZZZ]]");
});

test("puts the markers back", () => {
  const markup = "<p>Email [[EMAIL_7KQ4ZM]] today</p>";
  const element = answer(markup);
  const text = element.querySelector("p")!.firstChild;
  showOriginals(element, VALUES);

  hideOriginals();

  expect(element.innerHTML).toBe(markup);
  // The very node the page made, so the page can keep updating it
  expect(element.querySelector("p")!.firstChild).toBe(text);
});

test("puts back the last answer's markers before showing another", () => {
  const element = answer("<p>[[EMAIL_7KQ4ZM]]</p><p>[[EMAIL_N3PX2D]]</p>");
  const [first, second] = element.querySelectorAll("p");
  showOriginals(first, VALUES);

  showOriginals(second, VALUES);

  expect(first.textContent).toBe("[[EMAIL_7KQ4ZM]]");
  expect(shown(second)).toEqual(["<b>al@example.org</b>"]);
});
