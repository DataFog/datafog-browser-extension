import { expect, SAMPLE, test } from "./fixtures";

for (const site of ["claude", "gemini", "grok", "deepseek"] as const) {
  test(`${site}: opted-in native paste replaces locally and Undo preserves the unsent draft`, async ({
    extension,
  }) => {
    const options = await extension.options();
    await expect(options.locator("#auto-replace-on-paste")).not.toBeChecked();
    await options.locator("#auto-replace-on-paste").check();
    await expect(options.locator("#status")).toHaveText("Saved");
    await options.close();
    const chat = await extension.newChat({ site });
    const badge = extension.badge(chat);
    const composer = chat.locator("[contenteditable],textarea").first();
    const read = () =>
      site === "deepseek" ? composer.inputValue() : composer.innerText();
    await extension.context.grantPermissions(
      ["clipboard-read", "clipboard-write"],
      { origin: new URL(chat.url()).origin },
    );
    await chat.bringToFront();
    await chat.evaluate((text) => navigator.clipboard.writeText(text), SAMPLE);
    await composer.focus();
    await chat.keyboard.press("ControlOrMeta+V");
    await expect
      .poll(read)
      .toMatch(
        /^my email is \[\[EMAIL_[A-Z0-9]+\]\] and card \[\[CREDIT_CARD_[A-Z0-9]+\]\]$/,
      );
    await expect(chat.locator("#sent-count")).toHaveText("0");
    await expect
      .poll(async () => (await badge.state(".paste-toast")).text)
      .toContain("Replaced 2 items");
    await badge.click(".toast-undo");
    await expect.poll(read).toBe(SAMPLE);
    await expect(chat.locator("#sent-count")).toHaveText("0");
  });
}
