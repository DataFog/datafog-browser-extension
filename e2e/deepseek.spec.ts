import { redactAll } from "./fixtures";
import { expect, expectBadgeFitsBox, SAMPLE, test } from "./fixtures";

const EDITOR = 'textarea[name="search"]';
const SEND = '[role="button"].ds-button--circle';

test("DeepSeek: checks the chat box, matches its size and redacts", async ({
  extension,
}) => {
  const chat = await extension.newChat({ site: "deepseek" });
  const badge = extension.badge(chat);
  const composer = chat.locator(EDITOR);
  const box = chat.locator("#card");
  await composer.fill(SAMPLE);
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toBe("2 found · click to review");
  // Level with the card's bottom edge, so the card was found as the box
  await expectBadgeFitsBox(badge, box, 60, "24px");

  await badge.click(".dot");
  await redactAll(badge);

  await expect(composer).toHaveValue(
    "my email is [EMAIL] and card [CREDIT_CARD]",
  );
  await expect(chat.locator("#sent-count")).toHaveText("0");
});

for (const sendMethod of ["button", "Enter"] as const) {
  test(`DeepSeek: ${sendMethod} is held until an explicit popup choice`, async ({
    extension,
  }) => {
    const options = await extension.options();
    await options.locator("#block-sends").check();
    await expect(options.locator("#status")).toHaveText("Saved");
    await options.close();
    const chat = await extension.newChat({ site: "deepseek" });
    const badge = extension.badge(chat);
    const composer = chat.locator(EDITOR);
    await composer.fill(SAMPLE);
    await expect
      .poll(() => badge.state(".dot").then((state) => state.title))
      .toContain("found");
    const send = async () => {
      if (sendMethod === "button") await chat.locator(SEND).click();
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
