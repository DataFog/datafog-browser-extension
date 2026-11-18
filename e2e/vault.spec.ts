import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

const PASSWORD = "correct horse battery staple";
const EMAIL = "jane@example.com";

async function createVault(panel: Page, remember = false): Promise<void> {
  await expect(panel.locator("#create")).toBeVisible();
  await panel.locator("#create-password").fill(PASSWORD);
  await panel.locator("#create-confirm").fill(PASSWORD);
  await panel.locator("#create-remember").setChecked(remember);
  await panel.locator("#create-submit").click();
  await expect(panel.locator("#vault-state")).toHaveAttribute(
    "aria-label",
    "Unlocked",
  );
}

async function unlock(panel: Page, password = PASSWORD): Promise<void> {
  await panel.locator("#unlock-password").fill(password);
  await panel.locator("#unlock button[type=submit]").click();
}

test("vault creation has no recovery flow; lock and wrong/right passwords", async ({
  extension,
  chat,
}) => {
  await chat.bringToFront();
  const panel = await extension.panel();
  await createVault(panel);
  await panel.reload();
  await expect(
    panel.getByText("Forgot password?", { exact: true }),
  ).toHaveCount(0);
  await expect(panel.locator("#recovery-key")).toHaveCount(0);
  await panel.locator("#lock").click();
  await expect(panel.locator("#vault-state")).toHaveAttribute(
    "aria-label",
    "Locked",
  );
  await unlock(panel, "wrong password");
  await expect(panel.locator("#vault-error")).toHaveText(
    "That password isn't right.",
  );
  await expect(panel.locator("#unlock")).toBeVisible();
  await unlock(panel);
  await expect(panel.locator("#vault-state")).toHaveAttribute(
    "aria-label",
    "Unlocked",
  );
  await expect(panel.locator("#vault-error")).toBeHidden();
});

test("Pseudonymize reviews originals before replacing and Undo restores text", async ({
  extension,
  chat,
  badge,
}) => {
  const panel = await extension.panel();
  await createVault(panel);
  await chat.locator("#prompt-textarea").fill(`Contact ${EMAIL}`);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(panel.locator("#review-items")).toContainText(EMAIL);
  await expect(panel.locator("#review-items .marker")).toContainText(
    "[[EMAIL_",
  );
  await expect(chat.locator("#prompt-textarea")).toHaveText(`Contact ${EMAIL}`);
  await panel.locator("#approve").click();
  await expect(chat.locator("#prompt-textarea")).toHaveText(
    /Contact \[\[EMAIL_[A-Z0-9]+\]\]/,
  );
  await badge.click(".dot");
  await expect
    .poll(async () => (await badge.state(".undo")).disabled)
    .toBe(false);
  await badge.click(".undo");
  await expect(chat.locator("#prompt-textarea")).toHaveText(`Contact ${EMAIL}`);
});

test("Mark sensitive replaces one value, rechecks, and reviews the rest", async ({
  extension,
  chat,
  badge,
}) => {
  const panel = await extension.panel();
  await createVault(panel);
  const composer = chat.locator("#prompt-textarea");
  await composer.fill(`Contact ${EMAIL} or al@example.org`);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("2");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(panel.locator("#review-items li")).toHaveCount(2);

  await panel
    .locator("#review-items li")
    .nth(1)
    .getByRole("button", { name: "Mark sensitive" })
    .click();
  await expect(panel.locator("#review-status")).toHaveText(
    "Replaced in the chat box",
  );
  await expect(composer).toHaveText(
    /^Contact jane@example\.com or \[\[EMAIL_[A-Z0-9]+\]\]$/,
  );
  await expect(panel.locator("#review-items li")).toHaveCount(1);
  await expect(panel.locator("#review-items")).toContainText(EMAIL);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");

  await panel.locator("#approve").click();
  await expect(panel.locator("#review-status")).toHaveText(
    "Replaced 1 value in the chat box",
  );
  await expect(composer).toHaveText(
    /^Contact \[\[EMAIL_[A-Z0-9]+\]\] or \[\[EMAIL_[A-Z0-9]+\]\]$/,
  );
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toContain("no sensitive data found");
});

test("Not sensitive is skipped while unlocked and flagged again after locking", async ({
  extension,
  chat,
  badge,
}) => {
  const panel = await extension.panel();
  await createVault(panel);
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(panel.locator("#review-items li")).toHaveCount(1);
  await panel
    .locator("#review-items")
    .getByRole("button", { name: "Not sensitive", exact: true })
    .click();
  await expect(panel.locator("#not-sensitive")).toContainText(EMAIL);
  await expect(panel.locator("#review-items li")).toHaveCount(0);
  // The chat box is checked again without editing it
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toContain("no sensitive data found");
  await chat.locator("#prompt-textarea").fill(`Contact ${EMAIL}`);
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toContain("no sensitive data found");
  await panel.locator("#lock").click();
  await expect(panel.locator("#unlock")).toBeVisible();
  await chat.locator("#prompt-textarea").fill(`Please contact ${EMAIL}`);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
});

test("Remember this device survives browser restart; Forget removes automatic unlock", async ({
  extension,
  chat,
}) => {
  await chat.bringToFront();
  let panel = await extension.panel();
  await createVault(panel, true);
  await extension.restart();
  await extension.newChat();
  panel = await extension.panel();
  await expect(panel.locator("#vault-state")).toHaveAttribute(
    "aria-label",
    "Unlocked",
  );
  await expect(panel.locator("#remembered")).toBeVisible();
  await panel.locator("#forget-device").click();
  await expect(panel.locator("#remembered")).toBeHidden();
  await extension.restart();
  await extension.newChat();
  panel = await extension.panel();
  await expect(panel.locator("#unlock")).toBeVisible();
  await unlock(panel);
  await expect(panel.locator("#vault-state")).toHaveAttribute(
    "aria-label",
    "Unlocked",
  );
});

test("Delete requires DELETE; RESET and a typo preserve the vault", async ({
  extension,
  chat,
  badge,
}) => {
  const panel = await extension.panel();
  await createVault(panel, true);
  const allowed = "allowed@example.com";
  await chat.locator("#prompt-textarea").fill(`${EMAIL} and ${allowed}`);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("2");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(panel.locator("#review-items li")).toHaveCount(2);
  await panel
    .locator("#review-items li")
    .filter({ hasText: allowed })
    .getByRole("button", { name: "Not sensitive", exact: true })
    .click();
  await expect(panel.locator("#review-items li")).toHaveCount(1);
  const marker = (await panel
    .locator("#review-items .marker")
    .textContent())!.replace("→ ", "");
  await panel.locator("#approve").click();
  await expect(chat.locator("#prompt-textarea")).toContainText(marker);
  await panel.locator("#lock").click();
  await panel.locator("#delete-open").click();
  await expect(panel.locator("#delete")).toContainText(
    "Type DELETE to confirm",
  );
  for (const mistyped of ["RESET", "DELET", "DELETEE"]) {
    await panel.locator("#delete-confirm").fill(mistyped);
    await expect(panel.locator("#delete-submit")).toBeDisabled();
    await panel
      .locator("#delete")
      .evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(panel.locator("#create")).toBeHidden();
    await expect(panel.locator("#vault-state")).toHaveAttribute(
      "aria-label",
      "Locked",
    );
  }
  await panel.locator("#delete-confirm").fill("DELETE");
  await panel.locator("#delete-submit").click();
  await expect(panel.locator("#create")).toBeVisible();
  await expect(panel.locator("#remembered")).toBeHidden();
  expect(
    await extension.worker.evaluate(
      async () => (await chrome.storage.local.get("vault")).vault,
    ),
  ).toBeUndefined();
  await panel.reload();
  await expect(panel.locator("#create")).toBeVisible();
  await createVault(panel);
  await expect(panel.locator("#not-sensitive li")).toHaveCount(0);
  await chat.locator("#prompt-textarea").fill(allowed);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await chat.evaluate((oldMarker) => {
    const answer = document.createElement("article");
    answer.dataset.messageAuthorRole = "assistant";
    answer.textContent = oldMarker;
    document.body.append(answer);
  }, marker);
  await panel.locator("#restore-latest").click();
  await expect(panel.locator("#restored-summary")).toHaveText(
    "None of the 1 marker in this answer could be restored.",
  );
});
