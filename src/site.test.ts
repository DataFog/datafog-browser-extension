import { expect, test } from "vitest";

import { siteFor } from "./site";

test("knows ChatGPT and Claude, and treats an unknown host as ChatGPT", () => {
  expect(siteFor("chatgpt.com").name).toBe("ChatGPT");
  expect(siteFor("claude.ai").name).toBe("Claude");
  expect(siteFor("localhost").name).toBe("ChatGPT");
});
