import { expect, test } from "./fixtures";
test("larger document view keeps originals local and synchronizes approved decisions", async ({
  extension,
  chat,
}, testInfo) => {
  const panel = await extension.panel();
  await panel.locator("#pdf-file").setInputFiles("e2e/pdf-fixtures/mixed.pdf");
  await expect(panel.locator("#pdf-insert")).toBeEnabled({ timeout: 30000 });
  await panel.screenshot({ path: testInfo.outputPath("sidebar-original.png") });
  const popupReady = panel.context().waitForEvent("page");
  await panel.locator("#pdf-larger").click();
  const popup = await popupReady;
  await expect(popup.locator("#document-text")).toContainText(
    "jane@example.com",
  );
  await expect(chat.locator("#prompt-textarea")).toBeEmpty();
  await popup.screenshot({
    path: testInfo.outputPath("larger-view-original.png"),
  });
  await popup.locator("#as-sent").click();
  await expect(popup.locator("#document-text")).not.toContainText(
    "jane@example.com",
  );
  await expect(popup.locator("#document-text")).toContainText("[[EMAIL_");
  const email = popup
    .locator("#document-text .pdf-inline-value")
    .filter({ hasText: "[[EMAIL_" });
  await email.click();
  await popup
    .locator("#document-text .pdf-inline-controls button")
    .filter({ hasText: /^Mask$/ })
    .click();
  await expect(popup.locator("#document-text")).toContainText("[EMAIL]");
  await expect(panel.locator("#pdf-preview")).toContainText("[EMAIL]");
  await expect(popup.locator("#copy")).toBeEnabled();
  await popup.screenshot({
    path: testInfo.outputPath("larger-view-as-sent.png"),
  });
  await popup.locator("#copy").click();
  await expect(popup.locator("#status")).toContainText("Copied as sent");
  await expect(chat.locator("#prompt-textarea")).toBeEmpty();
  await popup.locator("#insert").click();
  await expect(chat.locator("#prompt-textarea")).toContainText("[EMAIL]");
  await expect(chat.locator("#prompt-textarea")).not.toContainText(
    "jane@example.com",
  );
  await expect(chat.locator("#sent-count")).toHaveText("0");
});
