import { redactAll } from "./fixtures";
import { test, expect } from "./fixtures";

const EMAIL = "jane@example.com";

test("Replace saves automatically in the popup and supports Undo/Redo", async ({
  chat,
  badge,
  extension,
}) => {
  const composer = chat.locator("#prompt-textarea");
  await composer.fill(`Contact ${EMAIL}`);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".dot");
  expect((await badge.state(".panel")).text).toContain(EMAIL);
  const preview = (await badge.state(".preview")).text.match(
    /\[\[EMAIL_[A-Z0-9]+\]\]/,
  )![0];
  await badge.click(".pseudonymize");
  await expect(composer).toHaveText(/Contact \[\[EMAIL_[A-Z0-9]+\]\]/);
  const replaced = await composer.innerText();
  expect(replaced).toBe(`Contact ${preview}`);
  await expect
    .poll(async () => (await badge.state(".undo")).disabled)
    .toBe(false);
  await badge.click(".undo");
  await expect(composer).toHaveText(`Contact ${EMAIL}`);
  // The rescan after Undo redraws the popup, which moves Redo
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".redo");
  await expect(composer).toHaveText(replaced);
  await expect(chat.locator("#sent-count")).toHaveText("0");
  expect(
    await extension.worker.evaluate(
      async () =>
        (
          await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.SIDE_PANEL],
          })
        ).length,
    ),
  ).toBe(0);
});

test("automatic FogVault access survives browser restart and idle worker stop", async ({
  extension,
  chat,
  badge,
}) => {
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(chat.locator("#prompt-textarea")).toHaveText(
    /\[\[EMAIL_[A-Z0-9]+\]\]/,
  );
  const marker = await chat.locator("#prompt-textarea").innerText();
  await extension.restart();
  const restarted = await extension.newChat();
  const panel = await extension.panel();
  await panel.locator('[data-view="data"]').click();
  await expect(panel.locator("#unlocked")).toBeVisible();
  await expect(
    panel.locator("#create-password, #lock, #forget-device"),
  ).toHaveCount(0);
  await extension.stopWorker();
  const nextBadge = extension.badge(restarted);
  await restarted.locator("#prompt-textarea").fill(EMAIL);
  await expect.poll(async () => (await nextBadge.state(".dot")).text).toBe("1");
  await nextBadge.click(".dot");
  await nextBadge.click(".pseudonymize");
  await expect(restarted.locator("#prompt-textarea")).toHaveText(marker);
});

test("Always allow is committed and rechecks the unchanged draft across restart", async ({
  extension,
  chat,
  badge,
}) => {
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(chat.locator("#prompt-textarea")).toContainText("[[EMAIL_");
  await badge.click(".undo");
  const panel = await extension.panel();
  await panel.locator('[data-view="data"]').click();
  const row = panel.locator("#originals li").filter({ hasText: EMAIL });
  await row.locator(".original-menu-toggle").click();
  await row.locator('[data-action="allow"]').click();
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toContain("nothing found");
  await expect(chat.locator("#prompt-textarea")).toHaveText(EMAIL);
  await extension.restart();
  const restarted = await extension.newChat();
  await restarted.locator("#prompt-textarea").fill(EMAIL);
  await expect
    .poll(async () => (await extension.badge(restarted).state(".dot")).title)
    .toContain("nothing found");
  const storage = await extension.worker.evaluate(() =>
    chrome.storage.local.get(null),
  );
  expect(JSON.stringify(storage)).not.toContain(EMAIL);
  expect(storage).not.toHaveProperty("settings");
});

test("encrypted preferences persist and a committed hold-sends change affects an unchanged draft", async ({
  extension,
  chat,
  badge,
}) => {
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  const options = await extension.options();
  await options.locator("#block-sends").check();
  await expect(options.locator("#status")).toHaveText("Saved");
  await options.close();
  await chat.locator('[data-testid="send-button"]').click();
  await expect
    .poll(async () => (await badge.state(".paused")).visible)
    .toBe(true);
  await expect(chat.locator("#sent-count")).toHaveText("0");
  const reopened = await extension.options();
  await expect(reopened.locator("#block-sends")).toBeChecked();
  expect(
    await extension.worker.evaluate(
      async () => (await chrome.storage.local.get("settings")).settings,
    ),
  ).toBeUndefined();
});

test("deletion cancellation preserves originals and confirmation removes them", async ({
  extension,
  chat,
  badge,
}) => {
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(chat.locator("#prompt-textarea")).toHaveText(
    /\[\[EMAIL_[A-Z0-9]+\]\]/,
  );
  const marker = await chat.locator("#prompt-textarea").innerText();
  const panel = await extension.panel();
  await panel.locator('[data-view="data"]').click();
  await expect(panel.locator("#originals")).toContainText(EMAIL);
  const options = await extension.options();
  await options.locator("#delete-open").click();
  await expect(options.locator("#delete")).toContainText("DELETE");
  await options.locator("#delete-confirm").fill("RESET");
  await expect(options.locator("#delete-submit")).toBeDisabled();
  await options.locator("#delete-cancel").click();
  await expect(options.locator("#delete")).toBeHidden();
  await expect(panel.locator("#unlocked")).toBeVisible();
  await expect(panel.locator("#originals")).toContainText(EMAIL);
  await options.locator("#delete-open").click();
  await options.locator("#delete-confirm").fill("DELETE");
  await options.locator("#delete-submit").click();
  await expect(options.locator("#delete-status")).toContainText("deleted");
  // The open sidebar follows the deletion without a reload
  await expect(panel.locator("#originals li")).toHaveCount(0);
  await panel.locator("#lookup-marker").fill(marker);
  await panel.locator("#lookup button").click();
  await expect(panel.locator("#lookup-result")).toContainText(
    "No original saved",
  );
});

test("missing automatic key preserves existing storage and reports checking unavailable", async ({
  extension,
  chat,
  badge,
}) => {
  await chat.locator("#prompt-textarea").fill(EMAIL);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(chat.locator("#prompt-textarea")).toHaveText(
    /\[\[EMAIL_[A-Z0-9]+\]\]/,
  );
  const route = await extension.worker.evaluate(
    async () => (await chrome.storage.local.get("vault")).vault,
  );
  await extension.worker.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("datafog-device");
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("devices", "readwrite");
      const request = tx.objectStore("devices").openCursor();
      request.addEventListener("success", () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.update({ ...cursor.value, key: null });
        cursor.continue();
      });
      tx.addEventListener("complete", () => resolve());
      tx.addEventListener("error", () => reject(tx.error));
    });
    db.close();
  });
  await extension.restart();
  const restarted = await extension.newChat();
  await restarted.locator("#prompt-textarea").fill(EMAIL);
  await expect
    .poll(async () => (await extension.badge(restarted).state(".dot")).title)
    .toMatch(/failed|unavailable|couldn't|unable/i);
  await expect(restarted.locator("#prompt-textarea")).toHaveText(EMAIL);
  expect(
    await extension.worker.evaluate(
      async () => (await chrome.storage.local.get("vault")).vault,
    ),
  ).toEqual(route);
});

test("another tab expiring a preview preserves the first draft until its refreshed preview is accepted", async ({
  extension,
  chat,
  badge,
}) => {
  const firstEditor = chat.locator("#prompt-textarea");
  await firstEditor.fill(EMAIL);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".dot");
  const firstPreview = (await badge.state(".preview")).text;

  const other = await extension.newChat({ path: "/c/other-draft" });
  const otherEditor = other.locator("#prompt-textarea");
  const otherBadge = extension.badge(other);
  await otherEditor.fill("another@example.org");
  await expect
    .poll(async () => (await otherBadge.state(".dot")).text)
    .toBe("1");
  await otherBadge.click(".dot");
  await otherBadge.click(".pseudonymize");
  await expect(otherEditor).toHaveText(/\[\[EMAIL_[A-Z0-9]+\]\]/);

  await chat.bringToFront();
  await badge.click(".pseudonymize");
  await expect
    .poll(async () => {
      const preview = (await badge.state(".preview")).text;
      return (
        preview !== firstPreview && /\[\[EMAIL_[A-Z0-9]+\]\]/.test(preview)
      );
    })
    .toBe(true);
  await expect(firstEditor).toHaveText(EMAIL);
  const refreshedMarker = (await badge.state(".preview")).text.match(
    /\[\[EMAIL_[A-Z0-9]+\]\]/,
  )![0];
  await badge.click(".pseudonymize");
  await expect(firstEditor).toHaveText(refreshedMarker);
  await expect(chat.locator("#sent-count")).toHaveText("0");
  await expect(other.locator("#sent-count")).toHaveText("0");
});

test("finding choices independently control repeated values for Replace and Redact", async ({
  chat,
  badge,
}) => {
  const editor = chat.locator("#prompt-textarea");
  const source = `${EMAIL} / ${EMAIL}`;
  await editor.fill(source);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("2");
  await badge.click(".dot");
  await badge.click(".preview li:first-child .choose");
  await expect
    .poll(
      async () =>
        (await badge.state(".preview li:nth-child(2) .choose")).disabled,
    )
    .toBe(false);
  await badge.click(".preview li:nth-child(2) .choose");
  await expect
    .poll(async () => (await badge.state(".pseudonymize")).disabled)
    .toBe(true);
  await expect
    .poll(
      async () =>
        (await badge.state(".preview li:nth-child(2) .choose")).disabled,
    )
    .toBe(false);
  await badge.click(".preview li:nth-child(2) .choose");
  await expect
    .poll(async () => (await badge.state(".pseudonymize")).text)
    .toBe("Apply");
  await expect
    .poll(async () => (await badge.state(".pseudonymize")).disabled)
    .toBe(false);
  const marker = (await badge.state(".preview")).text.match(
    /\[\[EMAIL_[A-Z0-9]+\]\]/,
  )![0];
  await badge.click(".pseudonymize");
  await expect(editor).toHaveText(`${EMAIL} / ${marker}`);
  await badge.click(".undo");
  await expect(editor).toHaveText(source);
  await editor.fill(`Edited ${source}`);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("2");
  if (!(await badge.state(".panel")).visible) await badge.click(".dot");
  await expect
    .poll(async () => (await badge.state(".pseudonymize")).text)
    .toBe("Apply");
  // Rechecks intentionally retain the old count; wait for actionable fresh results.
  await expect
    .poll(async () => (await badge.state(".pseudonymize")).disabled)
    .toBe(false);
  await badge.click(".preview li:first-child .choose");
  await expect
    .poll(async () => (await badge.state(".pseudonymize")).disabled)
    .toBe(false);
  await redactAll(badge);
  await expect(editor).toHaveText(`Edited ${EMAIL} / [EMAIL]`);
  await expect(chat.locator("#sent-count")).toHaveText("0");
});

test("saved-original menu allows a value and confirmed Forget retires it across answers and restart", async ({
  extension,
  chat,
  badge,
}) => {
  const editor = chat.locator("#prompt-textarea");
  await editor.fill(EMAIL);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(editor).toHaveText(/\[\[EMAIL_[A-Z0-9]+\]\]/);
  const marker = await editor.innerText();
  await chat.evaluate((token) => {
    const article = document.createElement("article");
    article.id = "forget-answer";
    const response = document.createElement("div");
    response.dataset.messageAuthorRole = "assistant";
    response.textContent = token;
    const actions = document.createElement("div");
    actions.dataset.actions = "";
    const copy = document.createElement("button");
    copy.textContent = "Copy";
    actions.append(copy);
    article.append(response, actions);
    document.querySelector("#answers")!.append(article);
  }, marker);
  const answerControl = extension.shadow(
    chat,
    "#forget-answer datafog-answer-control",
  );
  await answerControl.click("button");
  await expect(chat.locator("datafog-original")).toHaveCount(1);
  const panel = await extension.panel();
  await panel.locator('[data-view="data"]').click();
  const row = panel.locator("#originals li").filter({ hasText: marker });
  await row.locator(".original-menu-toggle").click();
  await row.locator('[data-action="forget"]').click();
  await row.locator('[data-action="cancel-forget"]').click();
  await expect(row).toContainText(EMAIL);
  await expect(chat.locator("datafog-original")).toHaveCount(1);
  await row.locator(".original-menu-toggle").click();
  await row.locator('[data-action="allow"]').click();
  await expect(row.locator(".allowed")).toHaveText("Allowed");
  await row.locator(".original-menu-toggle").click();
  await expect(row.locator('[data-action="allow"]')).toHaveCount(0);
  await row.locator('[data-action="forget"]').click();
  await row.locator('[data-action="confirm-forget"]').click();
  await expect(row).toHaveCount(0);
  await expect(chat.locator("datafog-original")).toHaveCount(0);
  await expect(
    chat.locator("#forget-answer [data-message-author-role=assistant]"),
  ).toHaveText(marker);
  await panel.locator("#lookup-marker").fill(marker);
  await panel.locator("#lookup button").click();
  await expect(panel.locator("#lookup-result")).toContainText(
    "No original saved",
  );
  await extension.restart();
  await extension.newChat();
  const reopened = await extension.panel();
  await reopened.locator('[data-view="data"]').click();
  await reopened.locator("#lookup-marker").fill(marker);
  await reopened.locator("#lookup button").click();
  await expect(reopened.locator("#lookup-result")).toContainText(
    "No original saved",
  );
});

test("one mixed Apply replaces, redacts and skips independently with one Undo and only replaced originals saved", async ({
  chat,
  badge,
  extension,
}) => {
  const kept = "4111 1111 1111 1111";
  const redacted = "private@example.net";
  const source = `Email ${EMAIL}; redact ${redacted}; keep ${kept}`;
  const composer = chat.locator("#prompt-textarea");
  await composer.fill(source);
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("3");
  await badge.click(".dot");
  await badge.click('.preview li:nth-child(2) .mode[data-mode="redact"]');
  await expect
    .poll(async () => (await badge.state(".pseudonymize")).disabled)
    .toBe(false);
  await badge.click('.choose[aria-label="Include 4111 1111 1111 1111"]');
  await expect
    .poll(async () => (await badge.state(".pseudonymize")).disabled)
    .toBe(false);
  const marker = (await badge.state(".preview li:first-child")).text.match(
    /\[\[EMAIL_[A-Z0-9]+\]\]/,
  )![0];
  await badge.click(".pseudonymize");
  await expect(composer).toHaveText(
    `Email ${marker}; redact [EMAIL]; keep ${kept}`,
  );
  await expect(chat.locator("#sent-count")).toHaveText("0");
  const panel = await extension.panel();
  await panel.locator('[data-view="data"]').click();
  await expect(panel.locator("#originals li")).toHaveCount(1);
  await expect(panel.locator("#originals li")).toContainText(EMAIL);
  await expect(panel.locator("#originals")).not.toContainText(redacted);
  await expect(panel.locator("#originals")).not.toContainText(kept);
  await chat.bringToFront();
  if (!(await badge.state(".panel")).visible) await badge.click(".dot");
  await badge.click(".undo");
  await expect(composer).toHaveText(source);
  // The rescan after Undo redraws the popup, which moves Redo
  await expect.poll(async () => (await badge.state(".dot")).text).toBe("3");
  await badge.click(".redo");
  await expect(composer).toHaveText(
    `Email ${marker}; redact [EMAIL]; keep ${kept}`,
  );
});
