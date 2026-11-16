import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a different secure password";
const EMAIL = "jane@example.com";

async function createVault(panel: Page, remember = false): Promise<string> {
  await expect(panel.locator("#create")).toBeVisible();
  await panel.locator("#create-password").fill(PASSWORD);
  await panel.locator("#create-confirm").fill(PASSWORD);
  await panel.locator("#create-remember").setChecked(remember);
  await panel.locator("#create-submit").click();
  await expect(panel.locator("#recovery")).toBeVisible();
  const key = (await panel.locator("#recovery-key").textContent())!;
  expect(Buffer.from(key, "base64")).toHaveLength(80);
  await panel.locator("#saved-key").click();
  await expect(panel.locator("#recovery")).toBeHidden();
  await expect(panel.locator("#recovery-key")).toHaveText("");
  await expect(panel.locator("#vault-state")).toHaveAttribute(
    "aria-label",
    "Unlocked",
  );
  return key;
}

async function unlock(panel: Page, password = PASSWORD): Promise<void> {
  await panel.locator("#unlock-password").fill(password);
  await panel.locator("#unlock button[type=submit]").click();
}

async function recover(
  panel: Page,
  key: string,
  password = NEW_PASSWORD,
): Promise<void> {
  if (!(await panel.locator("#recover").isVisible()))
    await panel.locator("#recover-open").click();
  await panel.locator("#recover-key").fill(key);
  await panel.locator("#recover-password").fill(password);
  await panel.locator("#recover-confirm").fill(password);
  await panel.locator("#recover-submit").click();
}

test("vault creation shows its key once; lock and wrong/right passwords", async ({
  extension,
  chat,
}) => {
  await chat.bringToFront();
  const panel = await extension.panel();
  await createVault(panel);
  await panel.reload();
  await expect(panel.locator("#recovery")).toBeHidden();
  await expect(panel.locator("#recovery-key")).toHaveText("");
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
    .getByRole("button", { name: "Not sensitive" })
    .click();
  await expect(panel.locator("#not-sensitive")).toContainText(EMAIL);
  await expect(panel.locator("#review-items li")).toHaveCount(0);
  await chat.locator("#prompt-textarea").fill(`Contact ${EMAIL}`);
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toContain("no sensitive data found");
  await panel.locator("#lock").click();
  await expect(panel.locator("#unlock")).toBeVisible();
  await chat.locator("#prompt-textarea").fill(`Please contact ${EMAIL}`);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
});

test("partial and wrong recovery keys show distinct errors", async ({
  extension,
  chat,
}) => {
  await chat.bringToFront();
  const panel = await extension.panel();
  const key = await createVault(panel);
  await panel.locator("#lock").click();
  await recover(panel, key.slice(0, key.length / 2));
  await expect(panel.locator("#vault-error")).toHaveText(
    "That isn't a whole recovery key. Copy all of it and try again.",
  );
  // Keep the 80-byte shape valid, but change every byte so FogVault attempts it.
  const wrong = Buffer.from(
    Buffer.from(key, "base64").map((byte) => byte ^ 0xff),
  ).toString("base64");
  await recover(panel, wrong);
  await expect(panel.locator("#vault-error")).toHaveText(
    "That recovery key doesn't open this vault.",
  );
  await expect(panel.locator("#vault-state")).toHaveAttribute(
    "aria-label",
    "Locked",
  );
});

test("recovery preserves values, rotates password/key, and forgets remembered access", async ({
  extension,
  chat,
  badge,
}) => {
  let panel = await extension.panel();
  const oldKey = await createVault(panel, true);
  await expect(panel.locator("#remembered")).toBeVisible();
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(panel.locator("#review-items .marker")).toHaveCount(1);
  const marker = (await panel
    .locator("#review-items .marker")
    .textContent())!.replace("→ ", "");
  await panel.locator("#approve").click();
  await expect(chat.locator("#prompt-textarea")).toHaveText(marker);
  await panel.locator("#lock").click();
  await recover(panel, oldKey);
  await expect(panel.locator("#recovery")).toBeVisible();
  const newKey = (await panel.locator("#recovery-key").textContent())!;
  expect(newKey).not.toBe(oldKey);
  expect(Buffer.from(newKey, "base64")).toHaveLength(80);
  await expect(panel.locator("#recovery-note")).toContainText(
    "a remembered device needs remembering again",
  );
  await panel.locator("#saved-key").click();
  await expect(panel.locator("#remembered")).toBeHidden();
  await chat.evaluate((savedMarker) => {
    const answer = document.createElement("article");
    answer.dataset.messageAuthorRole = "assistant";
    answer.textContent = savedMarker;
    document.body.append(answer);
  }, marker);
  await panel.locator("#restore-latest").click();
  await expect(panel.locator("#restored-summary")).toContainText(
    "Showing 1 original value in ChatGPT's answer.",
  );
  await expect(chat.locator("datafog-original")).toHaveCount(1);
  await panel.locator("#hide-originals").click();

  // Requesting the same value must return its original persisted marker.
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(panel.locator("#review-items .marker")).toHaveText(
    `→ ${marker}`,
  );
  await panel.locator("#approve").click();
  await panel.locator("#lock").click();
  await unlock(panel, PASSWORD);
  await expect(panel.locator("#vault-error")).toHaveText(
    "That password isn't right.",
  );
  await recover(panel, oldKey);
  await expect(panel.locator("#vault-error")).toHaveText(
    "That recovery key doesn't open this vault.",
  );
  await panel.locator("#recover-cancel").click();
  await unlock(panel, NEW_PASSWORD);
  await expect(panel.locator("#vault-state")).toHaveAttribute(
    "aria-label",
    "Unlocked",
  );
  await expect(panel.locator("#recovery")).toBeHidden();
  await expect(panel.locator("#recovery-key")).toHaveText("");
  await extension.restart();
  await extension.newChat();
  panel = await extension.panel();
  await expect(panel.locator("#unlock")).toBeVisible();
  await expect(panel.locator("#unlock-remember")).not.toBeChecked();
  await expect(panel.locator("#remembered")).toBeHidden();
  await unlock(panel, NEW_PASSWORD);
  await expect(panel.locator("#vault-state")).toHaveAttribute(
    "aria-label",
    "Unlocked",
  );
  await expect(panel.locator("#recovery")).toBeHidden();
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

test("Reset requires DELETE; RESET and a typo preserve the vault", async ({
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
    .getByRole("button", { name: "Not sensitive" })
    .click();
  await expect(panel.locator("#review-items li")).toHaveCount(1);
  const marker = (await panel
    .locator("#review-items .marker")
    .textContent())!.replace("→ ", "");
  await panel.locator("#approve").click();
  await expect(chat.locator("#prompt-textarea")).toContainText(marker);
  await panel.locator("#lock").click();
  await panel.locator("#reset-open").click();
  await expect(panel.locator("#reset")).toContainText("Type DELETE to confirm");
  for (const mistyped of ["RESET", "DELET", "DELETEE"]) {
    await panel.locator("#reset-confirm").fill(mistyped);
    await expect(panel.locator("#reset-submit")).toBeDisabled();
    await panel
      .locator("#reset")
      .evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(panel.locator("#create")).toBeHidden();
    await expect(panel.locator("#vault-state")).toHaveAttribute(
      "aria-label",
      "Locked",
    );
  }
  await panel.locator("#reset-confirm").fill("DELETE");
  await panel.locator("#reset-submit").click();
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
