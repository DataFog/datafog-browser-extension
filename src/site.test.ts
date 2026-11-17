// @vitest-environment happy-dom
import { expect, test } from "vitest";

import { siteFor } from "./site";

test("knows ChatGPT and Claude, and treats an unknown host as ChatGPT", () => {
  expect(siteFor("chatgpt.com").name).toBe("ChatGPT");
  expect(siteFor("claude.ai").name).toBe("Claude");
  expect(siteFor("localhost").name).toBe("ChatGPT");
});

test("finds Claude's answer prose, not the rest of its message", () => {
  document.body.innerHTML = `
    <div data-testid="assistant-message">
      <h3 class="sr-only">Claude responded: hi [[EMAIL_7KQ4ZM]]</h3>
      <div>Deciding how to answer.</div>
      <div data-cds="Prose"><p>hi [[EMAIL_7KQ4ZM]]</p></div>
      <span>just now</span>
    </div>`;
  const [selector] = siteFor("claude.ai").answers;

  const answers = document.querySelectorAll(selector);

  expect(answers).toHaveLength(1);
  expect(answers[0].textContent).toBe("hi [[EMAIL_7KQ4ZM]]");
});
