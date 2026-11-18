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
  await badge.click(".more-toggle");
  await badge.click(".redact");
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
  await badge.click(".more-toggle");
  await badge.click(".redact");
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
    await badge.click(".more-toggle");
    await badge.click(".redact");
    await expect(chat.locator("#prompt-textarea")).toHaveText("[EMAIL]");
    const sidePanel = await extension.panel();
    await sidePanel.emulateMedia({ colorScheme });
    await expect(sidePanel.locator("#unlocked")).toBeVisible();
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
}) => {
  const welcome = await extension.welcome();
  await expect(welcome.locator("#step-label")).toHaveText("Welcome");
  await expect(welcome.locator('[data-step="pin"]')).toBeVisible();
  await welcome.locator("#pin-next").click();
  await expect(welcome.locator('[data-step="done"]')).toBeVisible();
  // The vault may still be opening when a fresh profile starts
  await expect(welcome.locator("#vault-line")).toContainText(
    "Your vault is ready",
    { timeout: 15_000 },
  );
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
  expect((await badge.state(".more")).visible).toBe(false);
  await badge.click(".more-toggle");
  expect((await badge.state(".redact")).visible).toBe(true);
  await chat.keyboard.press("Escape");
  expect((await badge.state(".more")).visible).toBe(false);
  expect((await badge.state(".panel")).visible).toBe(true);
  await chat.keyboard.press("Escape");
  expect((await badge.state(".panel")).visible).toBe(false);
  await chat.keyboard.press("Enter");
  expect((await badge.state(".panel")).visible).toBe(true);
  await chat.locator("#prompt-textarea").click();
  expect((await badge.state(".panel")).visible).toBe(false);
});
