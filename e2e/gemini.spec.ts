import { expect, expectBadgeFitsBox, SAMPLE, test } from "./fixtures";

const EDITOR = "rich-textarea .ql-editor";

test("Gemini: checks the chat box, matches its size and redacts", async ({
  extension,
}) => {
  const chat = await extension.newChat({ site: "gemini" });
  const badge = extension.badge(chat);
  const composer = chat.locator(EDITOR);
  const box = chat.locator("input-area-v2");
  await composer.fill(SAMPLE);
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toBe("DataFog: 2 items found. Click to review.");
  await expectBadgeFitsBox(badge, box, 64, "50%");
  expect((await badge.state(".dismiss")).title).toContain("Gemini's own");

  await badge.click(".dot");
  await badge.click(".redact");

  await expect(composer).toHaveText(
    "my email is [EMAIL] and card [CREDIT_CARD]",
  );
  await expect(chat.locator("#sent-count")).toHaveText("0");
});

for (const sendMethod of ["button", "Enter"] as const) {
  test(`Gemini: ${sendMethod} is held once, and a second press sends`, async ({
    extension,
  }) => {
    const options = await extension.options();
    await options.locator("#block-sends").check();
    await expect(options.locator("#status")).toHaveText("Saved");
    await options.close();
    const chat = await extension.newChat({ site: "gemini" });
    const badge = extension.badge(chat);
    const composer = chat.locator(EDITOR);
    await composer.fill(SAMPLE);
    await expect
      .poll(() => badge.state(".dot").then((state) => state.title))
      .toContain("found");
    const send = async () => {
      if (sendMethod === "button")
        await chat.locator('button[aria-label="Send message"]').click();
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
