import { expect, test } from "vitest";

import { welcomeSteps, welcomeTarget } from "./welcome-state";

test("shows only the steps an install needs", () => {
  expect(welcomeSteps({ reload: false })).toEqual(["pin", "done"]);
  expect(welcomeSteps({ reload: true })).toEqual(["pin", "reload", "done"]);
});

test("welcome chooses the active supported tool without carrying private conversation paths", () => {
  expect(
    welcomeTarget([
      { url: "https://chatgpt.com/c/private", lastAccessed: 100 },
      {
        url: "https://claude.ai/chat/private?secret=x",
        active: true,
        lastAccessed: 1,
      },
    ]),
  ).toEqual({ name: "Claude", url: "https://claude.ai/" });
  expect(
    welcomeTarget([
      { url: "https://gemini.google.com/app/private", lastAccessed: 10 },
      { url: "https://grok.com/chat/private", lastAccessed: 20 },
    ]),
  ).toEqual({ name: "Grok", url: "https://grok.com/" });
  expect(
    welcomeTarget([
      { url: "https://evil.test/", active: true },
      { url: "http://claude.ai/" },
      { url: "invalid" },
    ]),
  ).toEqual({ name: "ChatGPT", url: "https://chatgpt.com/" });
});
