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
  await badge.click(".more-toggle");
  await badge.click(".allow");
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
