// @vitest-environment happy-dom
/**
 * Where the badge sits relative to the part of the chat box on screen, in
 * happy-dom's 1024 by 768 viewport.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Badge, OFF_TITLE } from "./badge";
import { siteFor, type Site } from "./site";

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
function mount(site?: Site): {
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
    {
      redact: () => {},
      pseudonymize: () => {},
      dismiss: () => {},
      undo: () => {},
      redo: () => {},
      send: () => {},
    },
    site,
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
  vi.unstubAllGlobals();
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

  expect(wrap.style.right).toBe("60px");
  expect(wrap.style.bottom).toBe("316px");
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

  expect(wrap.style.bottom).toBe("704px");
});

test.each([
  { host: "chatgpt.com", size: "56px", radius: "50%" },
  { host: "claude.ai", size: "44px", radius: "14px" },
  { host: "gemini.google.com", size: "64px", radius: "50%" },
  { host: "grok.com", size: "58px", radius: "50%" },
  { host: "chat.deepseek.com", size: "60px", radius: "24px" },
])(
  "keeps $host's size as the box grows and the window resizes",
  async ({ host, size, radius }) => {
    const { badge, box, scroller, wrap } = mount(siteFor(host));
    setBox(scroller, { top: 0, right: 1024, bottom: 768, left: 0 });
    const sizes = [];
    for (const top of [420, 280, 100]) {
      setBox(box, { top, right: 800, bottom: 480, left: 100 });
      badge.reposition();
      await new Promise(requestAnimationFrame);
      sizes.push(wrap.style.getPropertyValue("--size"));
    }
    window.dispatchEvent(new Event("resize"));
    await new Promise(requestAnimationFrame);
    sizes.push(wrap.style.getPropertyValue("--size"));

    expect(sizes).toEqual([size, size, size, size]);
    expect(wrap.style.getPropertyValue("--radius")).toBe(radius);
    expect(wrap.style.bottom).toBe("288px");
  },
);

test("hides when the chat box is off screen", async () => {
  const { badge, box, scroller, wrap } = mount();
  setBox(scroller, { top: 0, right: 1024, bottom: 768, left: 0 });
  setBox(box, { top: 900, right: 900, bottom: 960, left: 100 });

  badge.reposition();
  await new Promise(requestAnimationFrame);

  expect(wrap.style.visibility).toBe("hidden");
});

test("shows Dismiss, Pseudonymize and Redact only when values are found", () => {
  const { badge, wrap } = mount();
  const actions = wrap.querySelector<HTMLElement>(".actions")!;

  badge.show({ kind: "clean" });
  expect(actions.hidden).toBe(true);

  badge.show({ kind: "found", counts: { EMAIL: 1 } });
  expect(actions.hidden).toBe(false);
  const resolve = actions.querySelector(".resolve")!;
  expect(Array.from(resolve.children, (button) => button.textContent)).toEqual([
    "Pseudonymize",
    "Redact",
  ]);
});

test.each([
  {
    name: "clamps a narrow viewport and opens below a badge near the top",
    width: 333,
    height: 533,
    dot: { top: 51, right: 254, bottom: 75, left: 230 },
    left: "8px",
    top: "83px",
  },
  {
    name: "keeps the popup aligned above the badge when there is room",
    width: 1024,
    height: 768,
    dot: { top: 414, right: 932, bottom: 438, left: 908 },
    left: "626px",
    top: "218px",
  },
])("$name", ({ width, height, dot, left, top }) => {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", height);
  const { badge, box, scroller, wrap } = mount();
  setBox(scroller, { top: 0, right: width, bottom: height, left: 0 });
  setBox(box, { top: 100, right: width - 12, bottom: 200, left: 20 });
  const button = wrap.querySelector<HTMLButtonElement>(".dot")!;
  const panel = wrap.querySelector<HTMLElement>(".panel")!;
  setBox(button, dot);
  setBox(panel, { top: 0, right: 306, bottom: 188, left: 0 });
  badge.show({ kind: "found", counts: { EMAIL: 1 } });
  const badgeRight = wrap.style.right;

  button.click();

  expect(panel.hidden).toBe(false);
  expect(panel.style.left).toBe(left);
  expect(panel.style.top).toBe(top);
  expect(wrap.style.right).toBe(badgeRight);
});

test("greys out while checking is off, explaining why, with its panel kept shut", () => {
  const { badge, wrap } = mount();
  const dot = wrap.querySelector<HTMLButtonElement>(".dot")!;
  const panel = wrap.querySelector<HTMLElement>(".panel")!;

  badge.show({ kind: "off" });
  expect(wrap.hidden).toBe(false);
  expect(dot.className).toBe("dot off");
  expect(dot.title).toBe(OFF_TITLE);

  dot.click();
  badge.warnFiles(true);
  badge.show({ kind: "checking" });
  expect(panel.hidden).toBe(true);
  expect(dot.className).toBe("dot off");
});
