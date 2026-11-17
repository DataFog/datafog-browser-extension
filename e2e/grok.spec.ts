import {
  expect,
  expectBadgeFitsBox,
  measuredSize,
  SAMPLE,
  test,
} from "./fixtures";

const EDITOR = "form[data-composer] .ProseMirror";

test("Grok: checks the chat box, matches its size and redacts", async ({
  extension,
}) => {
  const chat = await extension.newChat({ site: "grok" });
  const badge = extension.badge(chat);
  const composer = chat.locator(EDITOR);
  const box = chat.locator("form[data-composer]");
  const empty = (await box.boundingBox())!.height;
  await composer.fill(SAMPLE);
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toBe("DataFog: 2 items found. Click to review.");
  await expectBadgeFitsBox(badge, box, measuredSize(empty), "50%");
  expect((await badge.state(".dismiss")).title).toContain("Grok's own");

  await badge.click(".dot");
  await badge.click(".redact");

  await expect(composer).toHaveText(
    "my email is [EMAIL] and card [CREDIT_CARD]",
  );
  await expect(chat.locator("#sent-count")).toHaveText("0");
});

for (const sendMethod of ["button", "Enter"] as const) {
  test(`Grok: ${sendMethod} is held once, and a second press sends`, async ({
    extension,
  }) => {
    const options = await extension.options();
    await options.locator("#block-sends").check();
    await options.locator("#save").click();
    await expect(options.locator("#status")).toHaveText("Saved");
    await options.close();
    const chat = await extension.newChat({ site: "grok" });
    const badge = extension.badge(chat);
    const composer = chat.locator(EDITOR);
    await composer.fill(SAMPLE);
    await expect
      .poll(() => badge.state(".dot").then((state) => state.title))
      .toContain("found");
    const send = async () => {
      if (sendMethod === "button")
        await chat.locator('[data-testid="chat-submit"]').click();
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
