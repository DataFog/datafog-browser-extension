import { redactAll } from "./fixtures";
import { expect, expectBadgeFitsBox, SAMPLE, test } from "./fixtures";

const EDITOR = "form[data-composer] .ProseMirror";

test("Grok: checks the chat box, matches its size and redacts", async ({
  extension,
}) => {
  const chat = await extension.newChat({ site: "grok" });
  const badge = extension.badge(chat);
  const composer = chat.locator(EDITOR);
  const box = chat.locator("form[data-composer]");
  await composer.fill(SAMPLE);
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toBe("2 found · click to review");
  await expectBadgeFitsBox(badge, box, 58, "50%");

  await badge.click(".dot");
  await redactAll(badge);

  await expect(composer).toHaveText(
    "my email is [EMAIL] and card [CREDIT_CARD]",
  );
  await expect(chat.locator("#sent-count")).toHaveText("0");
});

for (const sendMethod of ["button", "Enter"] as const) {
  test(`Grok: ${sendMethod} is held until an explicit popup choice`, async ({
    extension,
  }) => {
    const options = await extension.options();
    await options.locator("#block-sends").check();
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
      .toContain("Choose how to send this message.");
    await expect
      .poll(async () => (await badge.state(".pseudonymize")).text)
      .toBe("Apply & send");
    await send();
    if (sendMethod === "button") {
      await expect(chat.locator("#sent-count")).toHaveText("0");
      await badge.click(".pseudonymize");
    }
    // A distinct Enter activates the popup primary; the opening Enter did not.
    await expect(chat.locator("#sent-count")).toHaveText("1");
    await expect(chat.locator("#sent-text")).toHaveText(
      /my email is \[\[EMAIL_[A-Z0-9]+\]\] and card \[\[CREDIT_CARD_[A-Z0-9]+\]\]/,
    );
  });
}
