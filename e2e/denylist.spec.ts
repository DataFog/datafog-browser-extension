import { redactAll } from "./fixtures";
import type { Page } from "@playwright/test";
import { expect, test, type Extension } from "./fixtures";

const PHRASE = "Project Atlas";

/**
 * Add a phrase to the deny list, and allow it too, so the deny list must win.
 *
 * @param extension The loaded extension.
 */
async function flag(extension: Extension): Promise<void> {
  const panel = await extension.panel();
  await panel.locator('[data-view="rules"]').click();
  for (const list of ["denylist", "allowlist"]) {
    await panel.locator(`#${list}-value`).fill(PHRASE);
    await panel.locator(`#${list}-add button`).click();
    await expect(panel.locator(`#${list} li`)).toContainText(PHRASE);
  }
}

/**
 * Type a prompt holding the phrase, in another case, and wait for the badge.
 *
 * @param extension The loaded extension.
 * @returns The chat page.
 */
async function typePlan(extension: Extension): Promise<Page> {
  const chat = await extension.newChat();
  await chat.locator("#prompt-textarea").fill("Ship project atlas Friday");
  await expect
    .poll(() =>
      extension
        .badge(chat)
        .state(".dot")
        .then((state) => state.text),
    )
    .toBe("1");
  return chat;
}

test("deny list: a phrase is flagged and redacted even when allowed", async ({
  extension,
}) => {
  await flag(extension);
  const chat = await typePlan(extension);
  const badge = extension.badge(chat);

  await badge.click(".dot");
  await redactAll(badge);

  await expect(chat.locator("#prompt-textarea")).toHaveText(
    "Ship [DENYLIST] Friday",
  );
});

test("deny list: a phrase added in the side panel is flagged right away", async ({
  extension,
}) => {
  const panel = await extension.panel();
  await panel.locator('[data-view="rules"]').click();
  await panel.locator("#denylist-value").fill(PHRASE);
  await panel.locator("#denylist-add button").click();
  await expect(panel.locator("#denylist li")).toContainText(PHRASE);

  await typePlan(extension);

  await panel.locator("#denylist li button").click();
  await expect(panel.locator("#denylist li")).toHaveCount(0);
  await panel.reload();
  await panel.locator('[data-view="rules"]').click();
  await expect(panel.locator("#denylist li")).toHaveCount(0);
});

test("deny list: adding a phrase confirms it and checks the open chat again", async ({
  extension,
}) => {
  const chat = await extension.newChat();
  const badge = extension.badge(chat);
  await chat.locator("#prompt-textarea").fill("Ship project atlas Friday");
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toContain("nothing found");

  const panel = await extension.panel();
  await panel.locator('[data-view="rules"]').click();
  await panel.locator("#denylist-value").fill(PHRASE);
  await panel.locator("#denylist-add button").click();
  await expect(panel.locator("#save-status")).toHaveText("Saved");
  await expect(panel.locator("#denylist li")).toContainText(PHRASE);

  // Counted without editing the chat box
  await expect
    .poll(() => badge.state(".dot").then((state) => state.text))
    .toBe("1");

  await panel.locator("#denylist-value").fill(PHRASE);
  await panel.locator("#denylist-add button").click();
  await expect(panel.locator("#save-status")).toHaveText("Saved");
  await expect(panel.locator("#denylist li")).toHaveCount(1);
});

test("deny list: Replace saves and replaces a phrase with a marker", async ({
  extension,
}) => {
  await flag(extension);
  const chat = await typePlan(extension);
  const badge = extension.badge(chat);

  await badge.click(".dot");
  await badge.click(".pseudonymize");

  await expect(chat.locator("#prompt-textarea")).toHaveText(
    /Ship \[\[DENYLIST_[A-Z0-9]+\]\] Friday/,
  );
});
