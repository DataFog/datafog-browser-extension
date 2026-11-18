import path from "node:path";
import { chromium } from "@playwright/test";

/** Suspend only this checkout's unpacked build; never uninstall it or read its vault. */
export async function withSuspendedLocalExtension(
  endpoint,
  checkout,
  run,
  connect = chromium.connectOverCDP.bind(chromium),
  inherited = {},
) {
  const browser = await connect(endpoint);
  let session;
  let page;
  let original;
  let restore = false;
  try {
    session = await browser.newBrowserCDPSession();
    const { extensions } = await session.send("Extensions.getExtensions");
    if (inherited.id || inherited.path) {
      if (!inherited.id || !inherited.path || !path.isAbsolute(inherited.path))
        throw new Error(
          "An inherited suspension requires an extension ID and absolute path together.",
        );
      const existing = extensions.find((item) => item.id === inherited.id);
      if (
        !existing ||
        existing.enabled ||
        path.resolve(existing.path) !== path.resolve(inherited.path)
      )
        throw new Error(
          "The inherited original extension is not the exact disabled installation.",
        );
      return await run(existing.id, existing.path);
    }
    const active = extensions.filter(
      (item) => item.enabled && item.name.toLowerCase().startsWith("datafog"),
    );
    if (
      active.some(
        (item) => path.resolve(item.path) !== path.resolve(checkout, "dist"),
      )
    ) {
      throw new Error(
        "This browser has a different datafog installation. Its vault will not be changed.",
      );
    }
    original = active[0];
    if (original) {
      page = await browser.contexts()[0].newPage();
      await page.goto("chrome://extensions/");
      const toggle = page.locator(
        `extensions-item#${original.id} #enableToggle`,
      );
      if (!(await toggle.evaluate((element) => element.checked)))
        throw new Error(
          "The original extension's enabled state changed before the live run.",
        );
      restore = true;
      await toggle.click();
      await waitForEnabled(session, original.id, false);
    }
    return await run(original?.id, original?.path);
  } finally {
    try {
      if (restore) {
        await restoreOriginal(session, page, original);
      }
    } finally {
      await page?.close();
      await session?.detach();
      await browser.close();
    }
  }
}

async function waitForEnabled(session, id, enabled) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const { extensions } = await session.send("Extensions.getExtensions");
    if (extensions.some((item) => item.id === id && item.enabled === enabled))
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Could not confirm original datafog is ${enabled ? "enabled" : "disabled"}.`,
  );
}

async function restoreOriginal(session, page, original) {
  const { extensions } = await session.send("Extensions.getExtensions");
  const current = extensions.find((item) => item.id === original.id);
  if (!current)
    throw new Error(
      "The original datafog installation disappeared; refusing to recreate or reset its vault.",
    );
  if (!current.enabled) {
    await page.locator(`extensions-item#${original.id} #enableToggle`).click();
    await waitForEnabled(session, original.id, true);
  }
}
