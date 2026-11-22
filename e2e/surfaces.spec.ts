import { redactAll } from "./fixtures";
import type { Page } from "@playwright/test";

import { test, expect, SAMPLE } from "./fixtures";

const EMAIL = "jane@example.com";

/** CDP virtual time includes the extension's isolated content-script world. */
async function advanceRendererTime(page: Page, milliseconds: number) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Emulation.setVirtualTimePolicy", { policy: "pause" });
    const expired = new Promise<void>((resolve) => {
      session.once("Emulation.virtualTimeBudgetExpired", () => resolve());
    });
    await session.send("Emulation.setVirtualTimePolicy", {
      policy: "advance",
      budget: milliseconds,
    });
    await expired;
  } finally {
    await session.detach();
  }
}

test("reinjects the extension after navigating to another matched document", async ({
  extension,
}) => {
  const page = await extension.newChat();
  const badge = extension.badge(page);
  await page.locator("#prompt-textarea").fill(SAMPLE);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("2");
  await page.goto("https://chatgpt.com/c/integration-navigation");
  await page.locator("#prompt-textarea").fill(SAMPLE);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("2");
  await badge.click(".dot");
  expect((await badge.state("ul")).text).toContain("Email address: 1");
});

test("reattaches to a replacement contenteditable editor", async ({
  chat,
  badge,
}) => {
  await chat.locator("#prompt-textarea").fill("An earlier message");
  await chat.evaluate(() => {
    const editor = document.querySelector("#prompt-textarea")!;
    const replacement = editor.cloneNode(false);
    if (!(replacement instanceof HTMLElement))
      throw new Error("No cloned editor");
    replacement.id = "editing-earlier-message";
    editor.replaceWith(replacement);
  });
  await chat.locator("#editing-earlier-message").fill(SAMPLE);
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toContain("found");
  await badge.click(".dot");
  await redactAll(badge);
  await expect(chat.locator("#editing-earlier-message")).toContainText(
    "[EMAIL]",
  );
});

test("checks the textarea composer fallback", async ({ extension }) => {
  const page = await extension.newChat({ composer: "textarea" });
  const badge = extension.badge(page);
  await page.locator("textarea").evaluate((editor) => {
    const replacement = editor.cloneNode(true);
    if (!(replacement instanceof HTMLTextAreaElement))
      throw new Error("No cloned textarea");
    replacement.removeAttribute("id");
    editor.replaceWith(replacement);
  });
  await page.locator("textarea").fill(EMAIL);
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toContain("found");
  await badge.click(".dot");
  await redactAll(badge);
  await expect(page.locator("textarea")).toHaveValue("[EMAIL]");
});

test("reports an unprotected page when no supported composer exists", async ({
  extension,
}) => {
  const page = await extension.newChat({ composer: "none" });
  await advanceRendererTime(page, 10_000);
  await expect
    .poll(() =>
      extension.worker.evaluate(async () => {
        const tabs = await chrome.tabs.query({ active: true });
        return Promise.all(
          tabs.map(async (tab) => ({
            text: await chrome.action.getBadgeText({ tabId: tab.id }),
            title: await chrome.action.getTitle({ tabId: tab.id }),
          })),
        );
      }),
    )
    .toContainEqual({
      text: "!",
      title:
        "datafog can't find the chat box, so this page isn't being checked. Try reloading it.",
    });
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`badge and side panel stay usable in ${colorScheme} theme, a narrow window and 150% browser zoom`, async ({
    chat,
    badge,
    extension,
  }) => {
    await chat.emulateMedia({ colorScheme });
    await chat.setViewportSize({ width: 500, height: 800 });
    await chat.bringToFront();
    const zoom = await extension.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (tab?.id === undefined) throw new Error("No active ChatGPT tab");
      await chrome.tabs.setZoom(tab.id, 1.5);
      return chrome.tabs.getZoom(tab.id);
    });
    expect(zoom).toBe(1.5);
    await chat.locator("#prompt-textarea").fill(EMAIL);
    await expect
      .poll(async () => (await badge.state(".dot")).title)
      .toContain("found");
    await badge.click(".dot");
    const panel = await badge.state(".panel");
    const viewport = await chat.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    expect(panel.visible).toBe(true);
    expect(panel.rect.x).toBeGreaterThanOrEqual(0);
    expect(panel.rect.y).toBeGreaterThanOrEqual(0);
    expect(panel.rect.x + panel.rect.width).toBeLessThanOrEqual(viewport.width);
    expect(panel.rect.y + panel.rect.height).toBeLessThanOrEqual(
      viewport.height,
    );
    await redactAll(badge);
    await expect(chat.locator("#prompt-textarea")).toHaveText("[EMAIL]");
    const sidePanel = await extension.panel();
    await sidePanel.emulateMedia({ colorScheme });
    await expect(sidePanel.locator("#unlocked")).toBeVisible();
    await expect(
      sidePanel.locator("header.top .brand, header.top .logo"),
    ).toHaveCount(0);
    await expect(sidePanel.locator("header.top")).not.toContainText("datafog");
    await expect(sidePanel.locator("#vault-chip")).toBeVisible();
    await expect(sidePanel.locator("body")).toHaveCSS(
      "background-color",
      colorScheme === "dark" ? "rgb(26, 34, 38)" : "rgb(255, 255, 255)",
    );
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`settings page follows the ${colorScheme} theme`, async ({
    extension,
  }) => {
    const options = await extension.options();
    await options.emulateMedia({ colorScheme });
    const dark = colorScheme === "dark";
    await expect(options.locator("body")).toHaveCSS(
      "background-color",
      dark ? "rgb(26, 34, 38)" : "rgb(255, 255, 255)",
    );
    await expect(options.locator("body")).toHaveCSS(
      "color",
      dark ? "rgb(238, 240, 239)" : "rgb(14, 19, 22)",
    );
  });
}

test("a theme chosen in settings overrides the browser on every surface", async ({
  extension,
  chat,
  badge,
}) => {
  const options = await extension.options();
  await options.emulateMedia({ colorScheme: "light" });
  await options.locator('label:has(input[value="dark"])').click();
  await expect(options.locator("body")).toHaveCSS(
    "background-color",
    "rgb(26, 34, 38)",
  );
  const panel = await extension.panel();
  await panel.emulateMedia({ colorScheme: "light" });
  await expect(panel.locator("body")).toHaveCSS(
    "background-color",
    "rgb(26, 34, 38)",
  );
  await chat.emulateMedia({ colorScheme: "light" });
  await chat.locator("#prompt-textarea").fill("jane@example.com");
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".dot");
  await expect
    .poll(async () => (await badge.state(".panel")).visible)
    .toBe(true);
  expect(
    await chat.evaluate(() =>
      document.querySelector("datafog-badge")!.getAttribute("data-theme"),
    ),
  ).toBe("dark");
  await options.locator('label:has(input[value="system"])').click();
  await expect(panel.locator("body")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
});

test("settings restore defaults after confirming", async ({ extension }) => {
  const options = await extension.options();
  await options.locator("#site-claude").uncheck();
  await options.locator('input[value="PHONE"]').check();
  await expect(options.locator("#status")).toHaveText("Saved");

  options.once("dialog", (dialog) => void dialog.accept());
  await options.locator("#restore").click();
  await expect(options.locator("#site-claude")).toBeChecked();
  await options.reload();
  await expect(options.locator("#site-claude")).toBeChecked();
  await expect(options.locator('input[value="PHONE"]')).not.toBeChecked();
});

test("pastes several thousand words and records typing and scan timings", async ({
  chat,
  badge,
  extension,
}, testInfo) => {
  // A cold model scans thousands of words twice; this is a completion check,
  // while observed timings below remain evidence rather than a five-second SLA.
  test.slow();
  const text = `${"ordinary prompt words ".repeat(1500)} ${SAMPLE}`;
  const editor = chat.locator("#prompt-textarea");
  await extension.context.grantPermissions([
    "clipboard-read",
    "clipboard-write",
  ]);
  await chat.evaluate(
    (clipboardText) => navigator.clipboard.writeText(clipboardText),
    text,
  );
  await editor.click();
  const started = performance.now();
  await editor.press("ControlOrMeta+V");
  await expect(editor).toHaveText(text);
  const inserted = performance.now();
  await expect
    .poll(() => badge.state(".dot"), { timeout: 30_000 })
    .toMatchObject({ text: "2" });
  const scanned = performance.now();
  await editor.press("End");
  const typed = performance.now();
  await editor.pressSequentially(" followup@example.com");
  const finished = performance.now();
  await expect(editor).toContainText("followup@example.com");
  await expect
    .poll(() => badge.state(".dot"), { timeout: 30_000 })
    .toMatchObject({ text: "3" });
  const rescanned = performance.now();
  const timings = {
    words: text.trim().split(/\s+/).length,
    insertMs: inserted - started,
    scanObservedMs: scanned - inserted,
    keyboardInteractionMs: finished - typed,
    keyboardScanObservedMs: rescanned - finished,
    note: "Observed timings; no unapproved performance SLA is enforced.",
  };
  // Keep this evidence even when the CI artifact store is unavailable.
  console.log("Long-prompt timings:", JSON.stringify(timings));
  await testInfo.attach("long-prompt-timings", {
    contentType: "application/json",
    body: JSON.stringify(timings),
  });
});

test("keeps checking an open ChatGPT tab after an update, without a reload", async ({
  chat,
  badge,
  extension,
}) => {
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toContain("found");
  const versions = await extension.loadNewerBuild();
  expect(versions.after).not.toBe(versions.before);
  // The update reaches the open tab: the old copy steps aside for a new one
  await expect(chat.locator("datafog-badge")).toHaveCount(1);
  await chat.locator("#prompt-textarea").fill("after-update@example.com");
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toBe("1 found · click to review");
});

test("a chat tab open before install is checked without a reload", async ({
  extension,
}) => {
  // Simulate an install over an already-open tab: remove the copy the page
  // got on load by injecting again from the service worker
  const chat = await extension.newChat();
  await extension.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      files: ["content.js"],
    });
  });
  // A second live copy stands down: still one circle
  await expect(chat.locator("datafog-badge")).toHaveCount(1);
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect
    .poll(async () => (await extension.badge(chat).state(".dot")).title)
    .toBe("1 found · click to review");
});

test("the welcome page walks a new install through pinning to done", async ({
  extension,
}, testInfo) => {
  const welcome = await extension.welcome();
  await welcome.emulateMedia({ reducedMotion: "no-preference" });
  await expect(welcome.locator("#step-label")).toHaveText("Welcome");
  await expect(welcome.locator('[data-step="pin"]')).toBeVisible();
  await welcome.locator("#pin-next").click();
  await expect(welcome.locator('[data-step="done"]')).toBeVisible();
  await expect(welcome.locator('[data-step="done"] h1')).toHaveText(
    "Getting started",
  );
  await expect(welcome.getByRole("tab")).toHaveCount(0);
  await expect(welcome.locator("[data-demo-slide]")).toHaveCount(3);
  await expect(
    welcome.getByText("Silent demo · Fictional details", { exact: true }),
  ).toHaveCount(0);
  await expect(welcome.locator('[data-step="done"] > p:not(.sr)')).toHaveCount(
    0,
  );
  for (const name of ["replace", "originals", "copy"]) {
    const index = ["replace", "originals", "copy"].indexOf(name);
    if (index > 0) await welcome.locator("#demo-next").click();
    const panel = welcome.locator(`[data-demo-panel="${name}"]`);
    const video = panel.locator("video");
    await expect(panel).toBeVisible();
    await expect(
      welcome.locator(`[data-demo-slide="${index}"]`),
    ).toHaveAttribute("aria-current", "true");
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    const media = await video.evaluate((element: HTMLVideoElement) => ({
      source: element.currentSrc,
      poster: element.poster,
      duration: element.duration,
      muted: element.muted,
      loop: element.loop,
    }));
    expect(media.source).toBe(
      new URL(`assets/onboarding/${name}.webm`, welcome.url()).href,
    );
    expect(media.poster).toBe(
      new URL(`assets/onboarding/${name}.png`, welcome.url()).href,
    );
    expect(media.duration).toBeCloseTo(name === "replace" ? 6 : 3, 1);
    expect(media.muted).toBe(true);
    expect(media.loop).toBe(true);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(false);
    if (name === "copy") {
      await video.evaluate((element: HTMLVideoElement) => {
        element.currentTime = element.duration - 0.1;
      });
      await expect
        .poll(() =>
          video.evaluate((element: HTMLVideoElement) => element.currentTime),
        )
        .toBeLessThan(1);
      await expect(welcome.locator('[data-demo-slide="2"]')).toHaveAttribute(
        "aria-current",
        "true",
      );
    }
    await welcome.locator("#demo-playback").click();
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(true);
    for (const other of ["replace", "originals", "copy"].filter(
      (value) => value !== name,
    )) {
      expect(
        await welcome
          .locator(`[data-demo-panel="${other}"] video`)
          .evaluate((element: HTMLVideoElement) => element.paused),
      ).toBe(true);
    }
  }

  await welcome.locator("#demo-prev").click();
  await expect(welcome.locator('[data-demo-slide="1"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await welcome.locator("#demo-next").click();
  await expect(welcome.locator('[data-demo-slide="2"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
  await welcome.locator("#demo-playback").click();
  await welcome.screenshot({
    path: testInfo.outputPath("welcome-desktop.png"),
    fullPage: true,
  });
  await welcome.setViewportSize({ width: 390, height: 844 });
  expect(
    await welcome.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await welcome.screenshot({
    path: testInfo.outputPath("welcome-mobile.png"),
    fullPage: true,
  });
  await expect(welcome.locator("#done-try")).toHaveAttribute(
    "href",
    "https://chatgpt.com/",
  );
  expect(
    await extension.worker.evaluate(
      async () => (await chrome.storage.local.get("onboarded")).onboarded,
    ),
  ).toBeUndefined();
  await welcome.locator("#done-close").click();
  await expect
    .poll(() =>
      extension.worker.evaluate(
        async () => (await chrome.storage.local.get("onboarded")).onboarded,
      ),
    )
    .toBe(true);
});

test("welcome clips respect reduced motion and still support explicit keyboard playback", async ({
  extension,
}) => {
  await extension.newChat({ site: "claude" });
  const welcome = await extension.welcome();
  await welcome.emulateMedia({ reducedMotion: "reduce" });
  await welcome.reload();
  await welcome.locator("#pin-next").click();
  await expect(welcome.locator("#done-try")).toHaveAttribute(
    "href",
    "https://claude.ai/",
  );
  for (const name of ["replace", "originals", "copy"]) {
    const tab = welcome.locator(
      `[data-demo-slide="${["replace", "originals", "copy"].indexOf(name)}"]`,
    );
    await tab.focus();
    await welcome.keyboard.press("Enter");
    await expect(tab).toHaveAttribute("aria-current", "true");
    const video = welcome.locator(`[data-demo-panel="${name}"] video`);
    expect(
      await video.evaluate((element: HTMLVideoElement) => ({
        paused: element.paused,
        time: element.currentTime,
      })),
    ).toEqual({ paused: true, time: 0 });
  }
  const video = welcome.locator('[data-demo-panel="copy"] video');
  const playback = welcome.locator("#demo-playback");
  await playback.focus();
  await welcome.keyboard.press("Enter");
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(0);
  await expect(playback).toHaveAttribute("aria-label", "Pause demonstration");
  await welcome.keyboard.press("Enter");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(true);
  await expect(playback).toHaveAttribute("aria-label", "Play demonstration");
});

test("circle hover explains status, click opens actions, Escape and outside click dismiss", async ({
  chat,
  badge,
}) => {
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await expect(chat.locator("datafog-tab")).toHaveCount(0);
  const { rect } = await badge.state(".dot");
  await chat.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  expect((await badge.state(".panel")).visible).toBe(false);
  expect((await badge.state(".tooltip")).visible).toBe(true);
  expect((await badge.state(".tooltip")).text).toContain("found");
  await badge.click(".dot");
  expect((await badge.state(".panel")).visible).toBe(true);
  expect((await badge.state('.mode[data-mode="redact"]')).visible).toBe(true);
  await badge.click(".mode-help");
  expect((await badge.state(".mode-tooltip")).visible).toBe(true);
  expect((await badge.state(".mode-tooltip")).text).toContain(
    "Redact removes details without saving originals.",
  );
  expect((await badge.state(".mode-tooltip")).text).toContain(
    "Replace saves originals and inserts reversible tokens.",
  );
  await expect(badge.state(".sidebar")).rejects.toThrow();
  const firstLine = (await badge.state(".mode-tooltip p:first-child")).rect;
  const secondLine = (await badge.state(".mode-tooltip p:last-child")).rect;
  expect(secondLine.y).toBeGreaterThan(firstLine.y + firstLine.height);
  await chat.keyboard.press("Escape");
  expect((await badge.state(".panel")).visible).toBe(false);
  await badge.click(".dot");
  expect((await badge.state(".panel")).visible).toBe(true);
  await chat.locator("#prompt-textarea").click();
  expect((await badge.state(".panel")).visible).toBe(false);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`popup and quick Undo motion respect ${reducedMotion}`, async ({
    chat,
    badge,
  }) => {
    await chat.emulateMedia({ reducedMotion });
    const editor = chat.locator("#prompt-textarea");
    await editor.fill(EMAIL);
    await expect
      .poll(async () => (await badge.state(".dot")).title)
      .toContain("1 found");
    await badge.click(".dot");
    const popup = await badge.state(".panel");
    expect(popup.animationName).toBe(
      reducedMotion === "reduce" ? "none" : "popup-in",
    );
    expect(popup.animationDuration).toBe(
      reducedMotion === "reduce" ? "0s" : "0.14s",
    );
    const dot = await badge.state(".dot");
    expect(
      dot.transitionDuration
        .split(",")
        .map((value) => value.trim())
        .every(
          (value) => value === (reducedMotion === "reduce" ? "0s" : "0.14s"),
        ),
    ).toBe(true);
    await badge.click(".pseudonymize");
    await expect(editor).toContainText("[[EMAIL_");
    await expect
      .poll(async () => (await badge.state(".paste-toast")).visible)
      .toBe(true);
    const toast = await badge.state(".paste-toast");
    expect(toast.animationName).toBe(
      reducedMotion === "reduce" ? "none" : "toast-in",
    );
    expect(toast.animationDuration).toBe(
      reducedMotion === "reduce" ? "0s" : "0.14s",
    );
    await badge.click(".toast-undo");
    await expect(editor).toHaveText(EMAIL);
    await expect(chat.locator("#sent-count")).toHaveText("0");
  });
}

/** Composite computed RGB/RGBA paint onto the actual opaque popup surface. */
function composite(color: string, surface: number[]): number[] {
  const channels = color.match(/[\d.]+/g)!.map(Number);
  const alpha = channels[3] ?? 1;
  return channels
    .slice(0, 3)
    .map((value, index) => value * alpha + surface[index] * (1 - alpha));
}
function luminance(channels: number[]): number {
  const linear = channels.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(
  foreground: string,
  background: string,
  surface: string,
): number {
  const base = surface
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number);
  const paintedBackground = composite(background, base);
  const paintedForeground = composite(foreground, paintedBackground);
  const values = [
    luminance(paintedForeground),
    luminance(paintedBackground),
  ].toSorted((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
function middle(rect: { y: number; height: number }): number {
  return rect.y + rect.height / 2;
}
for (const colorScheme of ["light", "dark"] as const) {
  test(`popup row alignment, truncation and Apply hover/focus contrast in ${colorScheme}`, async ({
    chat,
    badge,
  }, testInfo) => {
    await chat.emulateMedia({ colorScheme });
    const email = "unusually.long.onboarding.value.for.review@northpine.studio";
    await chat.locator("#prompt-textarea").fill(email);
    await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
    await badge.click(".dot");
    const original = await badge.state(".original");
    const target = await badge.state(".to");
    const modes = await badge.state(".modes");
    expect(
      Math.abs(middle(original.rect) - middle(target.rect)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(middle(original.rect) - middle(modes.rect)),
    ).toBeLessThanOrEqual(2);
    expect(original.title).toBe(email);
    expect(original.textOverflow).toBe("ellipsis");
    expect(original.scrollWidth).toBeGreaterThan(original.clientWidth);
    const surface = (await badge.state(".panel")).backgroundColor;
    const replaceMode = await badge.state('.mode[data-mode="replace"]');
    expect(replaceMode.pressed).toBe("true");
    expect(
      contrast(replaceMode.color, replaceMode.backgroundColor, surface),
    ).toBeGreaterThanOrEqual(4.5);
    await badge.click('.mode[data-mode="redact"]');
    await expect
      .poll(async () => (await badge.state(".pseudonymize")).disabled)
      .toBe(false);
    const redactMode = await badge.state('.mode[data-mode="redact"]');
    expect(redactMode.pressed).toBe("true");
    expect((await badge.state('.mode[data-mode="replace"]')).pressed).toBe(
      "false",
    );
    expect(
      contrast(redactMode.color, redactMode.backgroundColor, surface),
    ).toBeGreaterThanOrEqual(4.5);
    expect(redactMode.color).toBe(replaceMode.color);
    expect(redactMode.backgroundColor).toBe(replaceMode.backgroundColor);
    const normal = await badge.state(".pseudonymize");
    expect(
      contrast(normal.color, normal.backgroundColor, surface),
    ).toBeGreaterThanOrEqual(4.5);
    await chat.mouse.move(
      normal.rect.x + normal.rect.width / 2,
      normal.rect.y + normal.rect.height / 2,
    );
    await chat.waitForTimeout(180);
    const hover = await badge.state(".pseudonymize");
    expect(
      contrast(hover.color, hover.backgroundColor, surface),
    ).toBeGreaterThanOrEqual(4.5);
    await chat.screenshot({
      path: testInfo.outputPath(`popup-${colorScheme}-hover.png`),
    });
    await chat.mouse.move(0, 0);
    for (
      let index = 0;
      index < 20 && !(await badge.state(".pseudonymize")).focused;
      index++
    )
      await chat.keyboard.press("Tab");
    const focus = await badge.state(".pseudonymize");
    expect(focus.focused).toBe(true);
    expect(
      contrast(focus.color, focus.backgroundColor, surface),
    ).toBeGreaterThanOrEqual(4.5);
    await chat.setViewportSize({ width: 390, height: 760 });
    await chat.waitForTimeout(180);
    const panel = (await badge.state(".panel")).rect;
    for (const selector of [".original", ".to", ".modes"]) {
      const item = (await badge.state(selector)).rect;
      expect(item.x).toBeGreaterThanOrEqual(panel.x);
      expect(item.x + item.width).toBeLessThanOrEqual(panel.x + panel.width);
    }
    expect(panel.x + panel.width).toBeLessThanOrEqual(390);
    await chat.screenshot({
      path: testInfo.outputPath(`popup-${colorScheme}-narrow.png`),
    });
    await expect(chat.locator("#sent-count")).toHaveText("0");
  });
}
