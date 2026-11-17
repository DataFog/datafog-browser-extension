import { expect, expectBadgeFitsBox, SAMPLE, test } from "./fixtures";

test("Claude: checks the chat box, matches its size and redacts", async ({
  extension,
}) => {
  const chat = await extension.newChat({ site: "claude" });
  const badge = extension.badge(chat);
  const composer = chat.locator('[data-testid="chat-input"]');
  const box = chat.locator('[data-cds-part="composer-card"]');
  const empty = (await box.boundingBox())!.height;
  await composer.fill(SAMPLE);
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toBe("DataFog: 2 items found. Click to review.");
  await expectBadgeFitsBox(badge, box, empty);
  expect((await badge.state(".dismiss")).title).toContain("Claude's own");

  await badge.click(".dot");
  await badge.click(".redact");

  await expect(composer).toHaveText(
    "my email is [EMAIL] and card [CREDIT_CARD]",
  );
  await expect(chat.locator("#sent-count")).toHaveText("0");
});

for (const sendMethod of ["button", "Enter"] as const) {
  test(`Claude: ${sendMethod} is held once, and a second press sends`, async ({
    extension,
  }) => {
    const options = await extension.options();
    await options.locator("#block-sends").check();
    await options.locator("#save").click();
    await expect(options.locator("#status")).toHaveText("Saved");
    await options.close();
    const chat = await extension.newChat({ site: "claude" });
    const badge = extension.badge(chat);
    const composer = chat.locator('[data-testid="chat-input"]');
    await composer.fill(SAMPLE);
    await expect
      .poll(() => badge.state(".dot").then((state) => state.title))
      .toContain("found");
    const send = async () => {
      if (sendMethod === "button")
        await chat.locator('[data-testid="chat-input-send"]').click();
      else await composer.press("Enter");
    };

    await send();
    await expect(chat.locator("#sent-count")).toHaveText("0");
    await expect
      .poll(() => badge.state(".paused").then((state) => state.text))
      .toContain("Sending is paused");
    await send();
    await expect(chat.locator("#sent-count")).toHaveText("1");
  });
}

test("settings: turning Claude off leaves ChatGPT checked", async ({
  extension,
}) => {
  const options = await extension.options();
  await expect(options.locator("#site-chatgpt")).toBeChecked();
  await options.locator("#site-claude").uncheck();
  await options.locator("#save").click();
  await expect(options.locator("#status")).toHaveText("Saved");
  await options.close();

  const claude = await extension.newChat({ site: "claude" });
  await claude.locator('[data-testid="chat-input"]').fill(SAMPLE);
  await expect
    .poll(() =>
      extension
        .badge(claude)
        .state(".dot")
        .then((state) => state.title),
    )
    .toContain("disabled");

  const chatgpt = await extension.newChat();
  await chatgpt.locator("#prompt-textarea").fill(SAMPLE);
  await expect
    .poll(() =>
      extension
        .badge(chatgpt)
        .state(".dot")
        .then((state) => state.title),
    )
    .toBe("DataFog: 2 items found. Click to review.");
});
