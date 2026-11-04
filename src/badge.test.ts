// @vitest-environment happy-dom
/**
 * Where the badge sits relative to the part of the chat box on screen, in
 * happy-dom's 1024 by 768 viewport.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Badge } from "./badge";

/**
 * Give an element a fixed box, since happy-dom does no layout.
 *
 * @param element The element.
 * @param box Its box in viewport coordinates.
 */
function setBox(
  element: Element,
  box: { top: number; right: number; bottom: number; left: number },
): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({
      x: box.left,
      y: box.top,
      width: box.right - box.left,
      height: box.bottom - box.top,
    }),
  );
}

/**
 * Show a badge on a chat box inside a scrolling container.
 *
 * @returns The chat box, its container, and the badge's positioned wrapper.
 */
function mount(): {
  badge: Badge;
  box: HTMLElement;
  scroller: HTMLElement;
  wrap: HTMLElement;
} {
  document.body.innerHTML =
    '<div style="overflow-y: auto"><div contenteditable="true"></div></div>';
  const scroller = document.querySelector<HTMLElement>("div")!;
  const box = document.querySelector<HTMLElement>("[contenteditable]")!;
  const badge = new Badge(
    () => {},
    () => {},
  );
  badge.attach(box);
  const wrap = document
    .querySelector("datafog-badge")!
    .shadowRoot!.querySelector<HTMLElement>(".wrap")!;
  return { badge, box, scroller, wrap };
}

beforeEach(() => {
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
  vi.restoreAllMocks();
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
});

test("sits beside the chat box when there's room", async () => {
  const { badge, box, scroller, wrap } = mount();
  setBox(scroller, { top: 0, right: 1024, bottom: 768, left: 0 });
  setBox(box, { top: 400, right: 900, bottom: 452, left: 100 });

  badge.reposition();
  await new Promise(requestAnimationFrame);

  expect(wrap.style.right).toBe("92px");
  expect(wrap.style.bottom).toBe("330px");
});

test("sits above the chat box when there's no room beside it", async () => {
  const { badge, box, scroller, wrap } = mount();
  setBox(scroller, { top: 0, right: 1024, bottom: 768, left: 0 });
  setBox(box, { top: 400, right: 1012, bottom: 452, left: 100 });

  badge.reposition();
  await new Promise(requestAnimationFrame);

  expect(wrap.style.right).toBe("20px");
  expect(wrap.style.bottom).toBe("376px");
});

test("stays on screen when the chat box fills the page", async () => {
  const { badge, box, scroller, wrap } = mount();
  setBox(scroller, { top: 0, right: 1024, bottom: 768, left: 0 });
  setBox(box, { top: 0, right: 1012, bottom: 768, left: 100 });

  badge.reposition();
  await new Promise(requestAnimationFrame);

  expect(wrap.style.bottom).toBe("736px");
});

test("hides when the chat box is off screen", async () => {
  const { badge, box, scroller, wrap } = mount();
  setBox(scroller, { top: 0, right: 1024, bottom: 768, left: 0 });
  setBox(box, { top: 900, right: 900, bottom: 960, left: 100 });

  badge.reposition();
  await new Promise(requestAnimationFrame);

  expect(wrap.style.visibility).toBe("hidden");
});
