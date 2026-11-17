import type { Page } from "@playwright/test";
import { expect, test, type Extension } from "./fixtures";

const PHRASE = "Project Atlas";

/**
 * Add a phrase to the deny list, and allow it too, so the deny list must win.
 *
 * @param extension The loaded extension.
 */
async function flag(extension: Extension): Promise<void> {
  const options = await extension.options();
  await options.locator("#denylist").fill(PHRASE);
  await options.locator("#allowlist").fill(PHRASE);
  await options.locator("#save").click();
  await expect(options.locator("#status")).toHaveText("Saved");
  await options.close();
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
  await badge.click(".redact");

  await expect(chat.locator("#prompt-textarea")).toHaveText(
    "Ship [DENYLIST] Friday",
  );
});

test("deny list: a phrase added in the side panel is flagged right away", async ({
  extension,
}) => {
  const panel = await extension.panel();
  await panel.locator("#denylist-value").fill(PHRASE);
  await panel.locator("#denylist-add button").click();
  await expect(panel.locator("#denylist li")).toContainText(PHRASE);

  await typePlan(extension);

  await panel.locator("#denylist li button").click();
  await expect(panel.locator("#denylist-note")).toHaveText("No phrases yet.");
  const options = await extension.options();
  await expect(options.locator("#denylist")).toHaveValue("");
});

test("deny list: Pseudonymize replaces a phrase with a marker", async ({
  extension,
}) => {
  await flag(extension);
  const panel = await extension.panel();
  await panel.locator("#create-password").fill("correct horse battery staple");
  await panel.locator("#create-confirm").fill("correct horse battery staple");
  await panel.locator("#create-submit").click();
  await expect(panel.locator("#vault-state")).toHaveAttribute(
    "aria-label",
    "Unlocked",
  );
  const chat = await typePlan(extension);
  const badge = extension.badge(chat);

  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(panel.locator("#review-items")).toContainText("project atlas");
  await panel.locator("#approve").click();

  await expect(chat.locator("#prompt-textarea")).toHaveText(
    /Ship \[\[DENYLIST_[A-Z0-9]+\]\] Friday/,
  );
});
