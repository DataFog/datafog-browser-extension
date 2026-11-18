import type { Page } from "@playwright/test";

import { test, expect, SAMPLE } from "./fixtures";

const EMAIL = "jane@example.com";

async function createVault(panel: Page): Promise<void> {
  await panel.locator("#create-password").fill("surface test password");
  await panel.locator("#create-confirm").fill("surface test password");
  await panel.locator("#create-submit").click();
  await expect(panel.locator("#lock")).toBeVisible();
}

/** Keep the chat active: a real side panel doesn't replace its active tab. */
async function panelAction(panel: Page, chat: Page, selector: string) {
  await chat.bringToFront();
  await panel
    .locator(selector)
    .evaluate((element: HTMLElement) => element.click());
}

async function addAnswer(chat: Page, text: string, id = "answer") {
  await chat.evaluate(
    (payload) => {
      const answer = document.createElement("article");
      answer.id = payload.id;
      answer.dataset.messageAuthorRole = "assistant";
      answer.textContent = payload.text;
      document.querySelector("#answers")!.append(answer);
    },
    { text, id },
  );
}

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
        "DataFog can't find the chat box, so this page isn't being checked. Try reloading it.",
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
    await badge.click(".redact");
    await expect(chat.locator("#prompt-textarea")).toHaveText("[EMAIL]");
    const sidePanel = await extension.panel();
    await sidePanel.emulateMedia({ colorScheme });
    await expect(sidePanel.locator("#create-submit")).toBeVisible();
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
      dark ? "rgb(238, 240, 239)" : "rgb(31, 31, 31)",
    );
    await expect(options.locator("#allowlist")).toHaveCSS(
      "background-color",
      dark ? "rgb(35, 45, 49)" : "rgb(245, 245, 245)",
    );
  });
}

test("settings restore defaults after confirming, keeping the lists", async ({
  extension,
}) => {
  const options = await extension.options();
  await options.locator("#site-claude").uncheck();
  await options.locator('input[value="PHONE"]').check();
  await options.locator("#denylist").fill("Project Falcon");
  await options.locator("#denylist").blur();
  await expect(options.locator("#status")).toHaveText("Saved");

  options.once("dialog", (dialog) => void dialog.accept());
  await options.locator("#restore").click();
  await expect(options.locator("#site-claude")).toBeChecked();
  await options.reload();
  await expect(options.locator("#site-claude")).toBeChecked();
  await expect(options.locator('input[value="PHONE"]')).not.toBeChecked();
  await expect(options.locator("#denylist")).toHaveValue("Project Falcon");
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

test("asks to reload ChatGPT after the installed extension is reloaded", async ({
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
  await chat.locator("#prompt-textarea").fill("after-update@example.com");
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toContain("DataFog was updated");
  await badge.click(".dot");
  expect((await badge.state(".note")).text).toBe(
    "Reload this page to keep checking this chat box.",
  );
});

test("restores only the latest answer, copies it, and hides originals", async ({
  chat,
  badge,
  extension,
}) => {
  const panel = await extension.panel();
  await createVault(panel);
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toContain("found");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(panel.locator("#review-items")).toContainText(EMAIL);
  await panel.locator("#approve").click();
  await expect(chat.locator("#prompt-textarea")).toHaveText(
    /\[\[EMAIL_[A-Z0-9]+\]\]/,
  );
  const marker = (await chat.locator("#prompt-textarea").innerText()).trim();
  await addAnswer(chat, `Earlier ${marker}`, "earlier-answer");
  await addAnswer(chat, `Latest ${marker}`);
  await panelAction(panel, chat, "#restore-latest");
  await expect(panel.locator("#restored-summary")).toContainText(
    "Showing 1 original value",
  );
  await expect(chat.locator("#earlier-answer datafog-original")).toHaveCount(0);
  await expect(chat.locator("#answer datafog-original")).toHaveCount(1);
  expect(
    (await extension.shadow(chat, "#answer datafog-original").state("span"))
      .text,
  ).toBe(EMAIL);
  // Closed roots keep originals out of the page's own text and scripts.
  await expect(chat.locator("#answer")).not.toContainText(EMAIL);
  expect(
    await chat.locator("datafog-original").evaluate((host) => host.shadowRoot),
  ).toBeNull();
  await extension.context.grantPermissions([
    "clipboard-read",
    "clipboard-write",
  ]);
  await panel.bringToFront();
  await panel.locator("#copy-restored").click();
  await expect
    .poll(() => panel.evaluate(() => navigator.clipboard.readText()))
    .toBe(`Latest ${EMAIL}`);
  await panelAction(panel, chat, "#hide-originals");
  await expect(chat.locator("datafog-original")).toHaveCount(0);
  await expect(chat.locator("#answer")).toHaveText(`Latest ${marker}`);
});

test("restores a streaming answer and can restore again after ChatGPT redraws it", async ({
  chat,
  badge,
  extension,
}) => {
  const panel = await extension.panel();
  await createVault(panel);
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toContain("found");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(panel.locator("#approve")).toBeEnabled();
  await panel.locator("#approve").click();
  await expect(chat.locator("#prompt-textarea")).toHaveText(
    /\[\[EMAIL_[A-Z0-9]+\]\]/,
  );
  const marker = (await chat.locator("#prompt-textarea").innerText()).trim();
  await addAnswer(chat, `Streaming ${marker}`);
  await chat
    .locator("#answer")
    .evaluate((answer) => answer.setAttribute("aria-busy", "true"));
  await panelAction(panel, chat, "#restore-latest");
  await expect(chat.locator("datafog-original")).toHaveCount(1);
  await extension.context.grantPermissions([
    "clipboard-read",
    "clipboard-write",
  ]);
  await panel.bringToFront();
  await panel.locator("#copy-restored").click();
  await expect
    .poll(() => panel.evaluate(() => navigator.clipboard.readText()))
    .toBe(`Streaming ${EMAIL}`);
  await panelAction(panel, chat, "#hide-originals");
  await expect(chat.locator("#answer")).toHaveText(`Streaming ${marker}`);
  await expect(chat.locator("#answer")).toHaveAttribute("aria-busy", "true");
  await panelAction(panel, chat, "#restore-latest");
  await expect(chat.locator("datafog-original")).toHaveCount(1);
  await chat.locator("#answer").evaluate((answer, answerMarker) => {
    answer.textContent = `Streaming ${answerMarker} completed`;
    answer.setAttribute("aria-busy", "false");
  }, marker);
  await expect(chat.locator("datafog-original")).toHaveCount(0);
  await panelAction(panel, chat, "#restore-latest");
  await expect(chat.locator("datafog-original")).toHaveCount(1);
  await extension.context.grantPermissions([
    "clipboard-read",
    "clipboard-write",
  ]);
  await panel.bringToFront();
  await panel.locator("#copy-restored").click();
  await expect
    .poll(() => panel.evaluate(() => navigator.clipboard.readText()))
    .toBe(`Streaming ${EMAIL} completed`);
  await panelAction(panel, chat, "#hide-originals");
  await expect(chat.locator("#answer")).toHaveText(
    `Streaming ${marker} completed`,
  );
});

test("side panels restore the active chat in their own window", async ({
  chat,
  badge,
  extension,
}) => {
  const secondChat = await extension.newChat({ path: "/c/second-window" });
  await secondChat.bringToFront();
  const secondWindow = await extension.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tab?.id === undefined) throw new Error("No second ChatGPT tab");
    return chrome.windows.create({ tabId: tab.id, type: "normal" });
  });
  expect(secondWindow?.id).toBeDefined();
  const secondBadge = extension.badge(secondChat);
  const firstPanel = await extension.panel(undefined, chat);
  await createVault(firstPanel);
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toContain("found");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(firstPanel.locator("#review-items")).toContainText(EMAIL);
  await firstPanel.locator("#approve").click();
  await expect(chat.locator("#prompt-textarea")).toHaveText(
    /\[\[EMAIL_[A-Z0-9]+\]\]/,
  );
  const firstMarker = (
    await chat.locator("#prompt-textarea").innerText()
  ).trim();
  await addAnswer(chat, `First window ${firstMarker}`);

  const secondPanel = await extension.panel(secondWindow!.id, secondChat);
  const secondEmail = "second-window@example.com";
  await secondChat.locator("#prompt-textarea").fill(secondEmail);
  await expect
    .poll(async () => (await secondBadge.state(".dot")).title)
    .toContain("found");
  await secondBadge.click(".dot");
  await secondBadge.click(".pseudonymize");
  await expect(secondPanel.locator("#review-items")).toContainText(secondEmail);
  await secondPanel.locator("#approve").click();
  await expect(secondChat.locator("#prompt-textarea")).toHaveText(
    /\[\[EMAIL_[A-Z0-9]+\]\]/,
  );
  const secondMarker = (
    await secondChat.locator("#prompt-textarea").innerText()
  ).trim();
  await addAnswer(secondChat, `Second window ${secondMarker}`);
  await panelAction(firstPanel, chat, "#restore-latest");
  await expect(chat.locator("datafog-original")).toHaveCount(1);
  await expect(secondChat.locator("datafog-original")).toHaveCount(0);
  await panelAction(secondPanel, secondChat, "#restore-latest");
  await expect(secondChat.locator("datafog-original")).toHaveCount(1);
  expect(
    (await extension.shadow(chat, "datafog-original").state("span")).text,
  ).toBe(EMAIL);
  expect(
    (await extension.shadow(secondChat, "datafog-original").state("span")).text,
  ).toBe(secondEmail);
  await panelAction(firstPanel, chat, "#hide-originals");
  await expect(chat.locator("datafog-original")).toHaveCount(0);
  await expect(secondChat.locator("datafog-original")).toHaveCount(1);
});
