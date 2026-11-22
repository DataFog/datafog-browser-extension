import { redactAll } from "./fixtures";
import type { Page } from "@playwright/test";

import { expect, expectBadgeFitsBox, SAMPLE, test } from "./fixtures";

interface BadgeControls {
  state(selector: string): Promise<{
    text: string;
    title: string;
    visible: boolean;
    disabled: boolean;
  }>;
  click(selector: string): Promise<void>;
}

async function found(badge: BadgeControls, count: number): Promise<void> {
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toBe(`${count} found · click to review`);
}

async function openBadge(badge: BadgeControls): Promise<void> {
  if (!(await badge.state(".panel")).visible) await badge.click(".dot");
  await expect
    .poll(() => badge.state(".panel").then((state) => state.visible))
    .toBe(true);
}

async function saveOptions(options: Page): Promise<void> {
  await expect(options.locator("#status")).toHaveText("Saved");
  await options.close();
}

test("the extension scans the editor and shows type counts", async ({
  extension,
}) => {
  const page = await extension.newChat();
  const badge = extension.badge(page);
  await page.locator("#prompt-textarea").fill(SAMPLE);
  await found(badge, 2);
  await openBadge(badge);
  await expect
    .poll(() => badge.state("ul").then((state) => state.text))
    .toContain("Email address: 1");
  await expect
    .poll(() => badge.state("ul").then((state) => state.text))
    .toContain("Card number: 1");
  // The draft popup previews the finding before replacement.
  expect((await badge.state(".panel")).text).toContain("jane@example.com");
});

test("checking and Redact still work after Chrome stops the idle service worker", async ({
  extension,
  chat,
  badge,
}) => {
  const composer = chat.locator("#prompt-textarea");
  await composer.fill(SAMPLE);
  await found(badge, 2);

  await extension.stopWorker();
  await composer.fill(`${SAMPLE} typed later`);
  await found(badge, 2);
  // Checked by a fresh worker, started by the chat
  expect(
    await extension.worker.evaluate(() => "stoppedByTest" in globalThis),
  ).toBe(false);
  await openBadge(badge);
  await redactAll(badge);
  await expect(composer).toHaveText(
    "my email is [EMAIL] and card [CREDIT_CARD] typed later",
  );
});

test("the badge keeps one round size in every state, as the box grows and as the window resizes", async ({
  chat,
  badge,
}) => {
  const box = chat.locator("form");
  const empty = (await box.boundingBox())!.height;
  const composer = chat.locator("#prompt-textarea");
  await expect(() => expectBadgeFitsBox(badge, box, 56, "50%")).toPass();
  await composer.fill(SAMPLE);
  await found(badge, 2);
  await expectBadgeFitsBox(badge, box, 56, "50%");
  await openBadge(badge);
  await redactAll(badge);
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toBe("Checked · nothing found");
  await expectBadgeFitsBox(badge, box, 56, "50%");

  // A long prompt makes the box taller; the badge keeps its size, level with
  // the box's bottom edge
  await composer.fill(Array(8).fill("a longer prompt").join("\n"));
  await expect
    .poll(async () => (await box.boundingBox())!.height)
    .toBeGreaterThan(empty + 20);
  await expectBadgeFitsBox(badge, box, 56, "50%");

  // Clearing the box, starting a new line and resizing the window keep it too
  await composer.fill("");
  await composer.press("Shift+Enter");
  await expectBadgeFitsBox(badge, box, 56, "50%");
  const { width, height } = chat.viewportSize()!;
  await chat.setViewportSize({ width: 700, height: height - 200 });
  // Too narrow to sit beside the box, so it moves above it at the same size
  await expect
    .poll(async () => (await badge.state(".dot")).rect.width)
    .toBe(56);
  expect((await badge.state(".dot")).rect.height).toBe(56);
  await chat.setViewportSize({ width, height });
  await expect(() => expectBadgeFitsBox(badge, box, 56, "50%")).toPass();
});

// The real model Worker is a separate browser integration path from rule WASM.
// Rule samples live in src/detect.test.ts; the README case checks their wiring.
const modelDetectors = [
  { entity: "PERSON", label: "Name", text: "My name is John Smith." },
  {
    entity: "ADDRESS",
    label: "Mailing address",
    text: "Please mail the package to 123 Main Street, Springfield, IL 62704.",
  },
];

for (const { entity, label, text } of modelDetectors) {
  test(`model Worker integration: ${entity}`, async ({ chat, badge }) => {
    await chat.locator("#prompt-textarea").fill(text);
    await expect
      .poll(() => badge.state(".dot").then((state) => state.title))
      .toContain("found · click to review");
    await openBadge(badge);
    await expect
      .poll(() => badge.state("ul").then((state) => state.text))
      .toContain(`${label}: 1`);
  });
}

// One representative browser settings round trip; unit tests cover patterns.
// UUID also verifies the explicit Core detect_uuid switch through messaging.
const optInDetectors = [
  {
    entity: "UUID",
    label: "UUID",
    text: "123e4567-e89b-12d3-a456-426614174000",
  },
];

for (const { entity, label, text } of optInDetectors) {
  test(`opt-in detector: ${entity} starts off and works after saving`, async ({
    chat,
    badge,
    extension,
  }) => {
    await chat.locator("#prompt-textarea").fill(text);
    await expect
      .poll(() => badge.state(".dot").then((state) => state.title))
      .toBe("Checked · nothing found");

    const options = await extension.options();
    await expect(options.locator(`input[value="${entity}"]`)).not.toBeChecked();
    await options.locator(`input[value="${entity}"]`).check();
    await saveOptions(options);
    await chat.reload();
    await chat.locator("#prompt-textarea").fill(text);
    await found(badge, 1);
    await openBadge(badge);
    await expect
      .poll(() => badge.state("ul").then((state) => state.text))
      .toContain(`${label}: 1`);

    const reopened = await extension.options();
    await expect(reopened.locator(`input[value="${entity}"]`)).toBeChecked();
  });
}

test("Redact, Undo and Redo preserve the prompt and edits invalidate history", async ({
  chat,
  badge,
}) => {
  const composer = chat.locator("#prompt-textarea");
  const redacted = "my email is [EMAIL] and card [CREDIT_CARD]";
  await composer.fill(SAMPLE);
  await found(badge, 2);
  await openBadge(badge);
  await redactAll(badge);
  await expect(composer).toHaveText(redacted);
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toBe("Checked · nothing found");

  await openBadge(badge);
  await expect
    .poll(() => badge.state(".undo").then((state) => state.disabled))
    .toBe(false);
  await badge.click(".undo");
  await expect(composer).toHaveText(SAMPLE);
  await found(badge, 2);
  await expect
    .poll(() => badge.state(".redo").then((state) => state.disabled))
    .toBe(false);
  await badge.click(".redo");
  await expect(composer).toHaveText(redacted);

  await composer.fill(`${redacted} edited`);
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toBe("Checked · nothing found");
  await openBadge(badge);
  await expect
    .poll(() => badge.state(".undo").then((state) => state.disabled))
    .toBe(true);
  await expect
    .poll(() => badge.state(".redo").then((state) => state.disabled))
    .toBe(true);
  await expect(chat.locator("#sent-count")).toHaveText("0");
});

test("Redact replaces a link chip, so its target is redacted too", async ({
  chat,
  badge,
}) => {
  const composer = chat.locator("#prompt-textarea");
  const url = "https://example.com/u/jane@example.com/profile";
  // As ChatGPT shows a pasted link: a chip holding the URL in attributes
  await composer.evaluate((element, link) => {
    element.innerHTML = `<p>in url: <span role="button" title="${link}" text-link-href="${link}">${link}</span> ok</p>`;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, url);
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toContain("found");
  await openBadge(badge);
  await redactAll(badge);

  await expect(composer).toContainText("[EMAIL]");
  expect(await composer.innerHTML()).not.toContain("jane@example.com");
});

test("Close leaves text intact and keeps findings available for review", async ({
  chat,
  badge,
}) => {
  const composer = chat.locator("#prompt-textarea");
  await composer.fill(SAMPLE);
  await found(badge, 2);
  await openBadge(badge);
  await badge.click(".close");
  await expect(composer).toHaveText(SAMPLE);
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toBe("2 found · click to review");
  await expect(chat.locator("#sent-count")).toHaveText("0");

  await composer.fill(`${SAMPLE} and jane@example.com`);
  await found(badge, 3);
});

test("pasting text through the browser clipboard detects the README sample", async ({
  chat,
  badge,
  extension,
}) => {
  await extension.context.grantPermissions(
    ["clipboard-read", "clipboard-write"],
    {
      origin: "https://chatgpt.com",
    },
  );
  await chat.bringToFront();
  await chat.evaluate((text) => navigator.clipboard.writeText(text), SAMPLE);
  await chat.locator("#prompt-textarea").focus();
  await chat.keyboard.press("ControlOrMeta+V");
  await expect(chat.locator("#prompt-textarea")).toHaveText(SAMPLE);
  await found(badge, 2);
});

test("sending is unrestricted by default even when findings are present", async ({
  chat,
  badge,
}) => {
  await chat.locator("#prompt-textarea").fill(SAMPLE);
  await found(badge, 2);
  await chat.locator('[data-testid="send-button"]').click();
  await expect(chat.locator("#sent-count")).toHaveText("1");
});

for (const sendMethod of ["button", "Enter"] as const) {
  test(`send blocking: ${sendMethod} holds native retries until an explicit popup choice`, async ({
    chat,
    badge,
    extension,
  }) => {
    const options = await extension.options();
    await options.locator("#block-sends").check();
    await saveOptions(options);
    await chat.reload();
    const composer = chat.locator("#prompt-textarea");
    await composer.fill(SAMPLE);
    await found(badge, 2);
    const send = async () => {
      if (sendMethod === "button")
        await chat.locator('[data-testid="send-button"]').click();
      else await composer.press("Enter");
    };

    await send();
    await expect(chat.locator("#sent-count")).toHaveText("0");
    await expect
      .poll(() => badge.state(".paused").then((state) => state.text))
      .toContain("Choose how to send this message.");
    expect((await badge.state(".send")).visible).toBe(false);
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

test("send blocking: Send as is bypasses the warning exactly once", async ({
  chat,
  badge,
  extension,
}) => {
  const options = await extension.options();
  await options.locator("#block-sends").check();
  await saveOptions(options);
  await chat.reload();
  await chat.locator("#prompt-textarea").fill(SAMPLE);
  await found(badge, 2);
  await chat.locator('[data-testid="send-button"]').click();
  await expect(chat.locator("#sent-count")).toHaveText("0");
  await badge.click(".preview li:first-child .choose");
  await expect
    .poll(
      async () =>
        (await badge.state(".preview li:nth-child(2) .choose")).disabled,
    )
    .toBe(false);
  await badge.click(".preview li:nth-child(2) .choose");
  await expect
    .poll(async () => (await badge.state(".pseudonymize")).text)
    .toBe("Send as is");
  await expect(chat.locator("#sent-count")).toHaveText("0");
  await badge.click(".pseudonymize");
  await expect(chat.locator("#sent-count")).toHaveText("1");
  await expect(chat.locator("#sent-text")).toHaveText(SAMPLE);
});

test("send blocking waits for an immediate send to be checked", async ({
  chat,
  badge,
  extension,
}) => {
  const options = await extension.options();
  await options.locator("#block-sends").check();
  await saveOptions(options);
  await chat.reload();
  await chat.locator("#prompt-textarea").fill(SAMPLE);
  // Send before the 400 ms typing debounce; no scan response is mocked.
  await chat.locator('[data-testid="send-button"]').click();
  await expect
    .poll(() => badge.state(".paused").then((state) => state.text))
    .toContain("Choose how to send this message.");
  await expect(chat.locator("#sent-count")).toHaveText("0");
});

test("Shift+Enter and an IME composition Enter do not send or raise a send warning", async ({
  chat,
  badge,
  extension,
}) => {
  const options = await extension.options();
  await options.locator("#block-sends").check();
  await saveOptions(options);
  await chat.reload();
  const composer = chat.locator("#prompt-textarea");
  await composer.fill(SAMPLE);
  await found(badge, 2);
  await composer.press("Shift+Enter");
  await composer.evaluate((element) => {
    // Exercise the browser's composition event contract. This does not drive
    // an operating-system input method or claim coverage of its candidate UI.
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });
  await expect(chat.locator("#sent-count")).toHaveText("0");
  expect((await badge.state(".paused")).visible).toBe(false);
});

for (const attachment of ["file picker", "drop", "image paste"] as const) {
  test(`attachments: ${attachment} warns that files are not protected`, async ({
    chat,
    badge,
  }) => {
    await chat.locator("#prompt-textarea").fill("A message with an attachment");
    await expect
      .poll(() => badge.state(".dot").then((state) => state.title))
      .toBe("Checked · nothing found");

    if (attachment === "file picker") {
      await chat.locator('input[type="file"]').setInputFiles({
        name: "private-details.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("jane@example.com"),
      });
    } else {
      await chat.evaluate((kind) => {
        // DataTransfer supplies real File objects; dispatching does not claim
        // coverage of the OS drag source or clipboard permission UI.
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(["test attachment"], "private-details.png", {
            type: "image/png",
          }),
        );
        if (kind === "drop") {
          document.body.dispatchEvent(
            new DragEvent("drop", { dataTransfer: transfer, bubbles: true }),
          );
        } else {
          document.querySelector("#prompt-textarea")!.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: transfer,
              bubbles: true,
            }),
          );
        }
      }, attachment);
    }
    await expect
      .poll(() => badge.state(".files").then((state) => state.visible))
      .toBe(true);
    expect((await badge.state(".files")).text).toContain(
      "Attached files aren't protected",
    );
    await expect(chat.locator("#sent-count")).toHaveText("0");
    await chat.locator('[data-testid="send-button"]').click();
    await expect(chat.locator("#sent-count")).toHaveText("1");
    expect((await badge.state(".files")).visible).toBe(false);
  });
}

test("settings: disabling a detector persists and leaves that type untouched", async ({
  chat,
  badge,
  extension,
}) => {
  const options = await extension.options();
  await options.locator('input[value="EMAIL"]').uncheck();
  await saveOptions(options);
  await chat.locator("#prompt-textarea").fill(SAMPLE);
  await found(badge, 1);
  await openBadge(badge);
  expect((await badge.state("ul")).text).toContain("Card number: 1");
  expect((await badge.state("ul")).text).not.toContain("Email address");
  await redactAll(badge);
  await expect(chat.locator("#prompt-textarea")).toHaveText(
    "my email is jane@example.com and card [CREDIT_CARD]",
  );
  const reopened = await extension.options();
  await expect(reopened.locator('input[value="EMAIL"]')).not.toBeChecked();
});

test("settings: exact allowlist survives reopening and Redact preserves allowed values", async ({
  chat,
  badge,
  extension,
}) => {
  const panel = await extension.panel();
  await panel.locator('[data-view="rules"]').click();
  await panel.locator("#allowlist-value").fill("jane@example.com");
  await panel.locator("#allowlist-add button").click();
  await expect(panel.locator("#allowlist li")).toContainText(
    "jane@example.com",
  );
  await chat.locator("#prompt-textarea").fill(SAMPLE);
  await found(badge, 1);
  await openBadge(badge);
  expect((await badge.state("ul")).text).toContain("Card number: 1");
  await redactAll(badge);
  await expect(chat.locator("#prompt-textarea")).toHaveText(
    "my email is jane@example.com and card [CREDIT_CARD]",
  );
  await panel.reload();
  await panel.locator('[data-view="rules"]').click();
  await expect(panel.locator("#allowlist li")).toContainText(
    "jane@example.com",
  );
  await chat.locator("#prompt-textarea").fill("other@example.com");
  await found(badge, 1);
});

test("settings: off greys out the badge and disabling checks also disables send blocking", async ({
  chat,
  badge,
  extension,
}) => {
  const options = await extension.options();
  await options.locator("#site-chatgpt").uncheck();
  await options.locator("#block-sends").check();
  await saveOptions(options);
  await chat.reload();
  await chat.locator("#prompt-textarea").fill(SAMPLE);
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toContain("is off for this site");
  await chat.locator('[data-testid="send-button"]').click();
  await expect(chat.locator("#sent-count")).toHaveText("1");

  const reopened = await extension.options();
  await expect(reopened.locator("#site-chatgpt")).not.toBeChecked();
  await reopened.locator("#site-chatgpt").check();
  await saveOptions(reopened);
  await chat.locator("#prompt-textarea").fill(`${SAMPLE} again`);
  await found(badge, 2);
});

test("non-English text and emoji survive detection, redaction and Undo", async ({
  chat,
  badge,
}) => {
  const text = "こんにちは 👩🏽‍💻 café — correo jane@example.com 🙂";
  const composer = chat.locator("#prompt-textarea");
  await composer.fill(text);
  await found(badge, 1);
  await openBadge(badge);
  await redactAll(badge);
  await expect(composer).toHaveText("こんにちは 👩🏽‍💻 café — correo [EMAIL] 🙂");
  await expect
    .poll(() => badge.state(".dot").then((state) => state.title))
    .toBe("Checked · nothing found");
  await openBadge(badge);
  await badge.click(".undo");
  await expect(composer).toHaveText(text);
});

test("held mixed Apply & send commits exactly the chosen preview and sends once", async ({
  chat,
  badge,
  extension,
}) => {
  const settings = await extension.options();
  await settings.locator("#block-sends").check();
  await saveOptions(settings);
  const composer = chat.locator("#prompt-textarea");
  await composer.fill(SAMPLE);
  await found(badge, 2);
  await chat.locator('[data-testid="send-button"]').click();
  await expect
    .poll(async () => (await badge.state(".pseudonymize")).text)
    .toBe("Apply & send");
  expect((await badge.state(".send")).visible).toBe(false);
  await expect(chat.locator("#sent-count")).toHaveText("0");
  await badge.click('.preview li:nth-child(2) .mode[data-mode="redact"]');
  await expect
    .poll(async () => (await badge.state(".pseudonymize")).text)
    .toBe("Apply & send");
  await expect
    .poll(async () => (await badge.state(".pseudonymize")).disabled)
    .toBe(false);
  const marker = (await badge.state(".preview")).text.match(
    /\[\[EMAIL_[A-Z0-9]+\]\]/,
  )![0];
  await badge.click(".pseudonymize");
  await expect(chat.locator("#sent-count")).toHaveText("1");
  await expect(chat.locator("#sent-text")).toHaveText(
    `my email is ${marker} and card [CREDIT_CARD]`,
  );
  const panel = await extension.panel();
  await expect(panel.locator("#originals")).toContainText("jane@example.com");
  await expect(panel.locator("#originals")).not.toContainText(
    "4111 1111 1111 1111",
  );
});

test("proactive Enter replaces without sending and quick Undo restores the draft", async ({
  chat,
  badge,
}) => {
  const composer = chat.locator("#prompt-textarea");
  await composer.fill(SAMPLE);
  await found(badge, 2);
  await badge.click(".dot");
  expect((await badge.state(".pseudonymize")).text).toBe("Apply");
  expect((await badge.state(".close")).visible).toBe(true);
  await chat.keyboard.press("Escape");
  await expect
    .poll(async () => (await badge.state(".panel")).visible)
    .toBe(false);
  await expect(composer).toHaveText(SAMPLE);
  await badge.click(".dot");
  await chat.keyboard.press("Enter");
  await expect(composer).toContainText("[[EMAIL_");
  await expect(chat.locator("#sent-count")).toHaveText("0");
  await expect
    .poll(async () => (await badge.state(".paste-toast")).visible)
    .toBe(true);
  await badge.click(".toast-undo");
  await expect(composer).toHaveText(SAMPLE);
  await expect(chat.locator("#sent-count")).toHaveText("0");
});

test("paste auto-replacement is opt-in, saves first, never sends, and offers Undo", async ({
  chat,
  badge,
  extension,
}) => {
  const settings = await extension.options();
  await expect(settings.locator("#auto-replace-on-paste")).not.toBeChecked();
  await settings.locator("#auto-replace-on-paste").check();
  await saveOptions(settings);
  await extension.context.grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: "https://chatgpt.com" },
  );
  await chat.bringToFront();
  await chat.evaluate((text) => navigator.clipboard.writeText(text), SAMPLE);
  const composer = chat.locator("#prompt-textarea");
  await composer.focus();
  await chat.keyboard.press("ControlOrMeta+V");
  await expect(composer).toHaveText(
    /my email is \[\[EMAIL_[A-Z0-9]+\]\] and card \[\[CREDIT_CARD_[A-Z0-9]+\]\]/,
  );
  await expect(chat.locator("#sent-count")).toHaveText("0");
  await expect
    .poll(async () => (await badge.state(".paste-toast")).text)
    .toContain("Replaced 2 items");
  await badge.click(".toast-undo");
  await expect(composer).toHaveText(SAMPLE);
  await expect(chat.locator("#sent-count")).toHaveText("0");
  const panel = await extension.panel();
  await expect(panel.locator("#originals")).toContainText("jane@example.com");
  const reopened = await extension.options();
  await expect(reopened.locator("#auto-replace-on-paste")).toBeChecked();
});

test("manual Undo toast leaves the nearby native Send hit target unobstructed", async ({
  chat,
  badge,
}) => {
  const composer = chat.locator("#prompt-textarea");
  await composer.fill(SAMPLE);
  await found(badge, 2);
  await badge.click(".dot");
  await badge.click(".pseudonymize");
  await expect(composer).toContainText("[[EMAIL_");
  await expect
    .poll(async () => (await badge.state(".paste-toast")).visible)
    .toBe(true);
  const dot = (await badge.state(".dot")).rect;
  const send = chat.locator('[data-testid="send-button"]');
  // Real ChatGPT puts Send just left of the circle, within the toast wrapper's
  // rectangular bounds but outside every painted extension control.
  await send.evaluate((element, circle) => {
    if (!(element instanceof HTMLElement))
      throw new Error("Send is not an HTML control");
    Object.assign(element.style, {
      position: "fixed",
      left: `${circle.x - 53}px`,
      top: `${circle.y + 12}px`,
      right: "auto",
      bottom: "auto",
      width: "36px",
      height: "36px",
      boxSizing: "border-box",
      margin: "0",
      padding: "0",
    });
  }, dot);
  await expect
    .poll(() =>
      send.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ) === element
        );
      }),
    )
    .toBe(true);
  await expect(chat.locator("#sent-count")).toHaveText("0");
  const replaced = await composer.innerText();
  await send.click();
  await expect(chat.locator("#sent-count")).toHaveText("1");
  await expect(chat.locator("#sent-text")).toHaveText(replaced);
});
