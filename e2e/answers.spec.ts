import { test, expect } from "./fixtures";

const EMAIL = "jane@example.com";
const sites = ["chatgpt", "claude", "gemini", "grok", "deepseek"] as const;
const composers = {
  chatgpt: "#prompt-textarea",
  claude: '[data-testid="chat-input"]',
  gemini: ".ql-editor",
  grok: ".ProseMirror",
  deepseek: "textarea",
};

for (const site of sites) {
  test(`${site}: per-answer originals include repeated, adjacent and unknown markers without changing provider text`, async ({
    extension,
  }) => {
    const chat = await extension.newChat({ site });
    const badge = extension.badge(chat);
    const composer = chat.locator(composers[site]);
    await composer.fill(EMAIL);
    await expect.poll(async () => (await badge.state(".dot")).text).toBe("1");
    await badge.click(".dot");
    await badge.click(".pseudonymize");
    const read = () =>
      site === "deepseek" ? composer.inputValue() : composer.innerText();
    await expect.poll(read).toMatch(/\[\[EMAIL_[A-Z0-9]+\]\]/);
    const marker = (await read()).trim();
    const text = `${marker}${marker} / [[EMAIL_UNKNOWN]]`;
    await chat.evaluate(
      ({ site: fixtureSite, text: answerText, marker: knownMarker }) => {
        function answer(id: string, value: string) {
          const article = document.createElement("article");
          article.id = id;
          const content = document.createElement("div");
          content.className = "provider-text";
          if (fixtureSite === "chatgpt")
            content.dataset.messageAuthorRole = "assistant";
          if (fixtureSite === "claude") {
            article.dataset.testid = "assistant-message";
            content.dataset.cds = "Prose";
          }
          if (fixtureSite === "grok") {
            article.dataset.testid = "assistant-message";
            content.classList.add("response-content-markdown");
          }
          if (fixtureSite === "deepseek")
            content.classList.add(
              "ds-markdown",
              "ds-assistant-message-main-content",
            );
          content.textContent = value;
          if (fixtureSite === "gemini") {
            const model = document.createElement("model-response");
            const message = document.createElement("message-content");
            content.classList.add("markdown");
            message.append(content);
            model.append(message);
            article.append(model);
          } else article.append(content);
          const actions = document.createElement("div");
          actions.dataset.actions = "";
          const copy = document.createElement("button");
          copy.textContent = "Copy";
          actions.append(copy);
          (fixtureSite === "gemini"
            ? article.querySelector("model-response")!
            : article
          ).append(actions);
          document.querySelector("#answers")!.append(article);
        }
        answer("answer-one", answerText);
        answer("answer-two", knownMarker);
        answer("unknown-answer", "[[EMAIL_UNKNOWN]]");
      },
      { site, text, marker },
    );
    await expect(chat.locator("datafog-answer-control:visible")).toHaveCount(2);
    const first = extension.shadow(chat, "#answer-one datafog-answer-control");
    const second = extension.shadow(chat, "#answer-two datafog-answer-control");
    await first.click("button");
    await expect
      .poll(async () => (await first.state("button")).text)
      .toContain("Hide originals");
    await expect(chat.locator("datafog-original")).toHaveCount(1);
    expect(
      (await extension.shadow(chat, "datafog-original").state("*")).text,
    ).toBe(`${EMAIL}${EMAIL} / [[EMAIL_UNKNOWN]]`);
    expect((await first.state('[role="status"]')).text).toContain(
      "could not be restored",
    );
    await expect(chat.locator("#answer-one .provider-text")).toHaveText(text);
    await expect(chat.locator("#answer-two .provider-text")).toHaveText(marker);
    expect((await second.state("button")).text).toContain("Show originals");
    await expect(chat.locator("#answer-one")).not.toContainText(EMAIL);
    await expect(chat.locator("#sent-count")).toHaveText("0");
    await second.click("button");
    await expect
      .poll(async () => (await second.state("button")).text)
      .toContain("Hide originals");
    await expect(chat.locator("datafog-original")).toHaveCount(2);
    await first.click("button");
    await expect
      .poll(async () => (await first.state("button")).text)
      .toContain("Show originals");
    await expect(chat.locator("datafog-original")).toHaveCount(1);
    expect((await second.state("button")).text).toContain("Hide originals");
    await chat
      .locator("#answer-one .provider-text")
      .evaluate((element, currentMarker) => {
        element.textContent = `Streaming ${currentMarker} completed`;
      }, marker);
    await expect(
      chat.locator("#answer-one datafog-answer-control"),
    ).toHaveCount(1);
    await first.click("button");
    await expect
      .poll(async () => (await first.state("button")).text)
      .toContain("Hide originals");
    await expect(chat.locator("#answer-one .provider-text")).toHaveText(
      `Streaming ${marker} completed`,
    );
    await chat.locator("#answer-two").evaluate((element) => element.remove());
    await expect(chat.locator("datafog-answer-control:visible")).toHaveCount(1);
  });
}
