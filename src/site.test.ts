// @vitest-environment happy-dom
import { expect, test } from "vitest";

import { siteFor, siteNames } from "./site";

test("knows each site, and treats an unknown host as ChatGPT", () => {
  expect(siteFor("chatgpt.com").name).toBe("ChatGPT");
  expect(siteFor("claude.ai").name).toBe("Claude");
  expect(siteFor("gemini.google.com").name).toBe("Gemini");
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

test("finds Gemini's answer text, not its label", () => {
  document.body.innerHTML = `
    <model-response>
      <div class="model-response-label-announcer">Gemini said</div>
      <message-content>
        <div class="markdown"><p>hi [[EMAIL_7KQ4ZM]]</p></div>
      </message-content>
    </model-response>`;
  const [selector] = siteFor("gemini.google.com").answers;

  const answers = document.querySelectorAll(selector);

  expect(answers).toHaveLength(1);
  expect(answers[0].textContent).toBe("hi [[EMAIL_7KQ4ZM]]");
});

test("names every site in one list", () => {
  expect(siteNames()).toBe("ChatGPT, Claude or Gemini");
});
