import path from "node:path";
import { randomUUID } from "node:crypto";
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
  let targetId;
  const contextId = inherited.contextId ?? process.env.LIVE_BROWSER_CONTEXT_ID;
  if (!contextId) {
    await browser.close();
    throw new Error(
      "Set LIVE_BROWSER_CONTEXT_ID to the verified signed-in Chrome profile context before running live tests.",
    );
  }
  const foreground = async () => {
    const { targetInfo } = await session.send("Target.getTargetInfo", {
      targetId,
    });
    if (targetInfo.browserContextId !== contextId)
      throw new Error(
        "The live extension page changed browser profile; refusing extension operations.",
      );
    await session.send("Target.activateTarget", { targetId });
  };
  try {
    session = await browser.newBrowserCDPSession();
    const url = `chrome://extensions/?datafog-live=${randomUUID()}`;
    const context = browser.contexts()[0];
    let anchor;
    for (const candidate of context.pages()) {
      const connection = await context.newCDPSession(candidate);
      try {
        const { targetInfo } = await connection.send("Target.getTargetInfo");
        if (targetInfo.browserContextId === contextId) {
          anchor = candidate;
          break;
        }
      } finally {
        await connection.detach();
      }
    }
    if (!anchor)
      throw new Error(
        "Open a tab in the verified Chrome profile before running live tests.",
      );
    // Normal Chrome profiles advertise context IDs but cannot reliably use
    // Target.createTarget with them. An opener stays in its verified profile.
    const ownedUrl = `about:blank#datafog-live-${randomUUID()}`;
    await anchor.evaluate((value) => {
      window.open(value, "_blank");
    }, ownedUrl);
    for (let attempt = 0; attempt < 100 && !page; attempt++) {
      page = context.pages().find((candidate) => candidate.url() === ownedUrl);
      if (!page) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!page)
      throw new Error(
        "The profile-bound popup did not attach; refusing extension operations.",
      );
    const connection = await context.newCDPSession(page);
    try {
      const { targetInfo } = await connection.send("Target.getTargetInfo");
      if (targetInfo.browserContextId !== contextId)
        throw new Error(
          "The live popup opened in another browser profile; refusing extension operations.",
        );
      targetId = targetInfo.targetId;
    } finally {
      await connection.detach();
    }
    await page.goto(url);
    await foreground();
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
      return await run(existing.id, existing.path, contextId);
    }
    if (
      (inherited.originalId || inherited.originalPath) &&
      (!inherited.originalId ||
        !inherited.originalPath ||
        !path.isAbsolute(inherited.originalPath))
    )
      throw new Error(
        "An external original requires its exact ID and absolute unpacked path together.",
      );
    const originalPath =
      inherited.originalPath ?? path.resolve(checkout, "dist");
    const active = extensions.filter(
      (item) => item.enabled && item.name.toLowerCase().startsWith("datafog"),
    );
    if (
      active.some(
        (item) =>
          path.resolve(item.path) !== path.resolve(originalPath) ||
          (inherited.originalId && item.id !== inherited.originalId),
      )
    ) {
      throw new Error(
        "This browser has a different datafog installation. Its vault will not be changed.",
      );
    }
    original = active[0];
    console.log(
      "Live original installation:",
      original
        ? JSON.stringify({ id: original.id, path: original.path })
        : "none",
    );
    if (original) {
      await foreground();
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
    return await run(original?.id, original?.path, contextId);
  } finally {
    try {
      if (restore) {
        await foreground();
        await restoreOriginal(session, page, original);
        console.log("Live original restored:", original.id);
      }
    } finally {
      if (page) await page.close();
      else if (targetId)
        await session?.send("Target.closeTarget", { targetId }).catch(() => {});
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
