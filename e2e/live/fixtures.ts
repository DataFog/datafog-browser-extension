import {
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ClosedShadow, Extension, SAMPLE } from "../fixtures";

export { expect, SAMPLE };

export function composerIn(page: Page): Locator {
  return page
    .locator(
      '#prompt-textarea:visible, form [contenteditable="true"]:visible, form textarea:visible',
    )
    .first();
}

export function sendButtonIn(page: Page): Locator {
  return page
    .locator(
      '[data-testid="send-button"]:visible, #composer-submit-button:visible, form button[type="submit"]:visible',
    )
    .first();
}

/** Prefer current renderer nodes without also counting legacy wrappers. */
export function userMessagesIn(page: Page): Locator {
  return page.locator(
    '[data-user-message-bubble], [data-message-author-role="user"]:not(:has([data-user-message-bubble])):not([data-user-message-bubble] *)',
  );
}

export function answersIn(page: Page): Locator {
  return page.locator(
    '[data-dil-response], [data-message-author-role="assistant"]:not(:has([data-dil-response])):not([data-dil-response] *)',
  );
}

/** A URL flag alone does not prove the site actually enabled this mode. */
export async function requireTemporaryChat(page: Page): Promise<void> {
  await expect(
    page
      .getByRole("main")
      .getByText("Temporary chat", { exact: true })
      .filter({ visible: true })
      .first(),
    "The real ChatGPT page must show temporary mode before sending test data",
  ).toBeVisible({ timeout: test.info().timeout });
}

/** Check the site's actual session, without returning or recording its contents. */
export async function requireSignedIn(page: Page): Promise<void> {
  const documentStatus = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    return navigation && "responseStatus" in navigation
      ? Number(navigation.responseStatus)
      : 0;
  });
  if (documentStatus === 403)
    throw new Error(
      "Live ChatGPT returned HTTP 403 before the editor loaded. Complete any browser verification in the dedicated Chrome test profile. A saved login may remain valid while ChatGPT denies this browser access; the live suite needs a browser session or runner the site accepts.",
    );
  const authenticated = await page.evaluate(async () => {
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "include",
      });
      if (!response.ok) return false;
      const session = await response.json();
      return Boolean(session?.user?.id || session?.user?.email);
    } catch {
      return false;
    }
  });
  if (!authenticated)
    throw new Error(
      "ChatGPT is not authenticated. Run npm run test:live:auth and sign in to the test account again; refresh the CI authentication secret if this is a CI run.",
    );
  await expect(
    composerIn(page),
    "The real ChatGPT composer must be available",
  ).toBeVisible({ timeout: test.info().timeout });
}

export async function found(badge: ClosedShadow, count: number): Promise<void> {
  await expect
    .poll(async () => (await badge.state(".dot")).title)
    .toBe(
      `DataFog: ${count} item${count === 1 ? "" : "s"} found. Click to review.`,
    );
}

export async function openBadge(badge: ClosedShadow): Promise<void> {
  if (!(await badge.state(".panel")).visible) await badge.click(".dot");
  await expect
    .poll(async () => (await badge.state(".panel")).visible)
    .toBe(true);
}

export async function saveOptions(options: Page): Promise<void> {
  await options.locator("#save").click();
  await expect(options.locator("#status")).toHaveText("Saved");
  await options.close();
}

export async function createVault(panel: Page): Promise<void> {
  const password = "synthetic live-test vault password";
  await panel.locator("#create-password").fill(password);
  await panel.locator("#create-confirm").fill(password);
  await panel.locator("#create-submit").click();
  await expect(panel.locator("#lock")).toBeVisible();
}

export const test = base.extend<{
  extension: Extension;
  chat: Page;
  composer: Locator;
  badge: ClosedShadow;
}>({
  extension: async ({ headless }, use, testInfo) => {
    const authPath = path.resolve(
      process.env.CHATGPT_STORAGE_STATE ?? ".playwright/chatgpt-auth.json",
    );
    const suppliedEndpoint = process.env.CHATGPT_CDP_ENDPOINT;
    const useHelperProfile =
      !suppliedEndpoint && process.env.CHATGPT_USE_OPEN_PROFILE === "1";
    const useOpenProfile = Boolean(suppliedEndpoint) || useHelperProfile;
    let cdpEndpoint: string | undefined = suppliedEndpoint;
    try {
      if (useHelperProfile) {
        const port = (
          await readFile(
            path.resolve(".playwright/live-profile/DevToolsActivePort"),
            "utf8",
          )
        ).split("\n")[0];
        cdpEndpoint = `http://127.0.0.1:${port}`;
      } else if (!suppliedEndpoint) await access(authPath);
    } catch {
      throw new Error(
        useOpenProfile
          ? "Open the dedicated test Chrome with npm run test:live:auth -- --keep-open, finish sign-in and leave that browser open."
          : "ChatGPT authentication state is missing. Run npm run test:live:auth before running the live suite, or set CHATGPT_STORAGE_STATE to the saved session file.",
      );
    }
    const profile = await mkdtemp(path.join(tmpdir(), "datafog-live-e2e-"));
    const extension = new Extension(profile, headless, {
      live: true,
      storageState: useOpenProfile ? undefined : authPath,
      cdpEndpoint,
      replaceHelperExtension: useHelperProfile,
    });
    try {
      await extension.start();
      testInfo.annotations.push({
        type: "browser",
        description: `Live ChatGPT in Google Chrome ${extension.context.browser()!.version()}`,
      });
      await use(extension);
    } finally {
      await extension.stop();
      await rm(profile, { recursive: true, force: true });
    }
  },
  chat: async ({ extension }, use) => {
    const page = await extension.newChat();
    await requireSignedIn(page);
    await use(page);
  },
  composer: async ({ chat }, use) => {
    await use(composerIn(chat));
  },
  badge: async ({ extension, chat }, use) => {
    await use(extension.badge(chat));
  },
});
