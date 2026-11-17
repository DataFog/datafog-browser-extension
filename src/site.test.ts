import { expect, test } from "vitest";

import { siteFor } from "./site";

test("knows ChatGPT, and treats an unknown host as ChatGPT", () => {
  expect(siteFor("chatgpt.com").name).toBe("ChatGPT");
  expect(siteFor("localhost").name).toBe("ChatGPT");
});
