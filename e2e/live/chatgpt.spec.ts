import {
  test,
  expect,
  SAMPLE,
  composerIn,
  sendButtonIn,
  userMessagesIn,
  answersIn,
  requireSignedIn,
  requireTemporaryChat,
  found,
  openBadge,
  saveOptions,
  createVault,
} from "./fixtures";

const EMAIL = "jane@example.com";

test("live: signed-in ChatGPT detects the README sample", async ({
  composer,
  badge,
}) => {
  await composer.fill(SAMPLE);
  await found(badge, 2);
  await openBadge(badge);
  const counts = (await badge.state("ul")).text;
  expect(counts).toContain("Email address: 1");
  expect(counts).toContain("Card number: 1");
});

test("live: Redact, Undo, Redo and an actual editor change", async ({
  composer,
  badge,
}) => {
  await composer.fill(SAMPLE);
  await found(badge, 2);
  await openBadge(badge);
  await badge.click(".redact");
  await expect(composer).toHaveText(
    "my email is [EMAIL] and card [CREDIT_CARD]",
  );
  await openBadge(badge);
  await badge.click(".undo");
  await expect(composer).toHaveText(SAMPLE);
  await badge.click(".redo");
  await expect(composer).toContainText("[EMAIL]");
  await composer.press("End");
  await composer.pressSequentially(" edited");
  await openBadge(badge);
  await expect
    .poll(async () => (await badge.state(".undo")).disabled)
    .toBe(true);
  await expect
    .poll(async () => (await badge.state(".redo")).disabled)
    .toBe(true);
});

test("live: Dismiss returns after editing the real composer", async ({
  composer,
  badge,
}) => {
  await composer.fill(EMAIL);
  await found(badge, 1);
  await openBadge(badge);
  await badge.click(".dismiss");
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toBe("DataFog");
  await composer.fill(`Please contact ${EMAIL}`);
  await found(badge, 1);
});

for (const [entity, text] of [
  ["PHONE", "415-555-0123"],
  ["DATE", "2026-11-16"],
  ["ZIP_CODE", "ZIP: 94105"],
  ["IP_ADDRESS", "192.168.1.42"],
  ["UUID", "123e4567-e89b-12d3-a456-426614174000"],
]) {
  test(`live: enabling ${entity} starts detecting it in ChatGPT`, async ({
    composer,
    badge,
    extension,
  }) => {
    await composer.fill(text);
    await expect
      .poll(async () => (await badge.state(".dot")).title)
      .toBe("DataFog: no sensitive data found");
    const options = await extension.options();
    await options.locator(`input[value="${entity}"]`).check();
    await saveOptions(options);
    await composer.fill(`Test value: ${text}`);
    await found(badge, 1);
  });
}

test("live: allowlist and global off apply to the real composer", async ({
  composer,
  badge,
  extension,
}) => {
  await composer.fill(SAMPLE);
  await found(badge, 2);
  const options = await extension.options();
  await options.locator("#allowlist").fill(EMAIL);
  await saveOptions(options);
  await composer.fill(`${SAMPLE} updated`);
  await found(badge, 1);
  const settings = await extension.options();
  await settings.locator("#enabled").uncheck();
  await saveOptions(settings);
  await composer.fill(`${SAMPLE} checking disabled`);
  await expect
    .poll(async () => (await badge.state(".wrap")).visible)
    .toBe(false);
});

test("live: Pseudonymize reviews, replaces and undoes in ChatGPT", async ({
  composer,
  badge,
  extension,
}) => {
  const panel = await extension.panel();
  await createVault(panel);
  await composer.fill(EMAIL);
  await found(badge, 1);
  await openBadge(badge);
  await badge.click(".pseudonymize");
  await expect(panel.locator("#review-items")).toContainText(EMAIL);
  await expect(composer).toHaveText(EMAIL);
  await panel.locator("#approve").click();
  await expect(composer).toHaveText(/\[\[EMAIL_[A-Z0-9]+\]\]/);
  await openBadge(badge);
  await badge.click(".undo");
  await expect(composer).toHaveText(EMAIL);
});

test("live: Not sensitive is ignored until the vault locks", async ({
  composer,
  badge,
  extension,
}) => {
  const panel = await extension.panel();
  await createVault(panel);
  await composer.fill(EMAIL);
  await found(badge, 1);
  await openBadge(badge);
  await badge.click(".pseudonymize");
  await panel
    .locator("#review-items")
    .getByRole("button", { name: "Not sensitive" })
    .click();
  await expect(panel.locator("#not-sensitive")).toContainText(EMAIL);
  await composer.fill(`Contact ${EMAIL}`);
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toBe("DataFog: no sensitive data found");
  await panel.locator("#lock").click();
  await expect(panel.locator("#unlock")).toBeVisible();
  await composer.fill(`Please contact ${EMAIL}`);
  await found(badge, 1);
});

for (const method of ["button", "Enter"] as const) {
  test(`live: ${method} is held, then Send anyway reaches ChatGPT`, async ({
    extension,
  }) => {
    test.slow();
    const chat = await extension.newChat({ path: "/?temporary-chat=true" });
    await requireSignedIn(chat);
    await requireTemporaryChat(chat);
    const composer = composerIn(chat);
    const badge = extension.badge(chat);
    const options = await extension.options();
    await options.locator("#block-sends").check();
    await saveOptions(options);
    // Send-blocking state is loaded when the content script starts.
    await chat.reload();
    await requireSignedIn(chat);
    await requireTemporaryChat(chat);
    const prompt = `Automated DataFog regression test. Reply only OK. Test email: ${EMAIL}`;
    const userMessages = userMessagesIn(chat);
    const before = await userMessages.count();
    await composer.fill(prompt);
    await found(badge, 1);
    if (method === "button") await sendButtonIn(chat).click();
    else await composer.press("Enter");
    await expect
      .poll(async () => (await badge.state(".paused")).text)
      .toContain("Sending is paused");
    await expect(userMessages).toHaveCount(before);
    await badge.click(".send");
    await expect(userMessages).toHaveCount(before + 1, {
      timeout: test.info().timeout,
    });
    await expect(userMessages.last()).toContainText(EMAIL, {
      timeout: test.info().timeout,
    });
  });
}

test("live: pseudonyms survive a real response and restore, copy and hide", async ({
  extension,
}) => {
  test.slow();
  const chat = await extension.newChat({ path: "/?temporary-chat=true" });
  await requireSignedIn(chat);
  await requireTemporaryChat(chat);
  const composer = composerIn(chat);
  const badge = extension.badge(chat);
  const panel = await extension.panel(undefined, chat);
  await createVault(panel);
  await composer.fill(
    `Automated DataFog regression test. Repeat this test email exactly, including any bracketed marker replacing it: ${EMAIL}. After that write a short sentence confirming this is synthetic test data.`,
  );
  await found(badge, 1);
  await openBadge(badge);
  await badge.click(".pseudonymize");
  await expect(panel.locator("#review-items .marker")).toHaveCount(1);
  const marker = (await panel.locator("#review-items .marker").innerText())
    .replace("→ ", "")
    .trim();
  await panel.locator("#approve").click();
  await expect(composer).toContainText(marker);
  await sendButtonIn(chat).click();
  const answer = answersIn(chat).last();
  await expect(answer).toContainText(marker, { timeout: test.info().timeout });
  // The answer's Copy action appears when the real response is complete.
  // Restoring earlier can legitimately be undone by a streaming redraw.
  await expect(
    chat
      .getByRole("main")
      .getByRole("button", { name: "Copy", exact: true })
      .last(),
  ).toBeVisible({ timeout: test.info().timeout });
  await panel.locator("#restore-latest").click();
  await expect
    .poll(() => chat.locator("datafog-original").count(), {
      timeout: test.info().timeout,
    })
    .toBeGreaterThan(0);
  expect(
    (await extension.shadow(chat, "datafog-original").state("span")).text,
  ).toBe(EMAIL);
  await extension.context.grantPermissions([
    "clipboard-read",
    "clipboard-write",
  ]);
  await panel.bringToFront();
  await panel.locator("#copy-restored").click();
  await expect
    .poll(() => panel.evaluate(() => navigator.clipboard.readText()))
    .toContain(EMAIL);
  await panel.locator("#hide-originals").click();
  await expect(chat.locator("datafog-original")).toHaveCount(0);
  await expect(answer).toContainText(marker);
});

test("live: temporary chat supports detection and Redact", async ({
  extension,
}) => {
  const chat = await extension.newChat({ path: "/?temporary-chat=true" });
  await requireSignedIn(chat);
  await requireTemporaryChat(chat);
  const badge = extension.badge(chat);
  const composer = composerIn(chat);
  await composer.fill(SAMPLE);
  await found(badge, 2);
  await openBadge(badge);
  await badge.click(".redact");
  await expect(composer).toContainText("[EMAIL]");
});

// Account-specific surfaces are tested only when their actual URLs are supplied.
// No generated path or replacement page stands in for a real account surface.
for (const [surface, variable] of [
  ["existing chat", "CHATGPT_EXISTING_CHAT_URL"],
  ["project", "CHATGPT_PROJECT_URL"],
  ["custom GPT", "CHATGPT_CUSTOM_GPT_URL"],
]) {
  const configured = process.env[variable];
  if (!configured) continue;
  const url = new URL(configured);
  if (url.origin !== "https://chatgpt.com")
    throw new Error(`${variable} must be a real https://chatgpt.com URL`);
  test(`live: configured ${surface} supports detection and Redact`, async ({
    extension,
  }) => {
    const chat = await extension.newChat({
      path: `${url.pathname}${url.search}`,
    });
    await requireSignedIn(chat);
    const composer = composerIn(chat);
    const badge = extension.badge(chat);
    await composer.fill(SAMPLE);
    await found(badge, 2);
    await openBadge(badge);
    await badge.click(".redact");
    await expect(composer).toContainText("[EMAIL]");
    await composer.fill("");
  });
}
