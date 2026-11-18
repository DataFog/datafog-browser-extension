/** Sign in interactively; never collect or print the test account's credentials. */
import { chromium } from "@playwright/test";
import { chmod, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { chromeExecutable, launchManualChrome } from "./manual-chrome.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateDirectory = path.join(root, ".playwright");
const profile = path.join(privateDirectory, "live-profile");
const authFile = path.join(privateDirectory, "chatgpt-auth.json");
const keepOpen = process.argv.includes("--keep-open");

function chatGPTHost(host) {
  const normalized = host.replace(/^\./, "").toLowerCase();
  return normalized === "chatgpt.com" || normalized.endsWith(".chatgpt.com");
}

function allowedHost(host) {
  const normalized = host.replace(/^\./, "").toLowerCase();
  return (
    chatGPTHost(normalized) ||
    normalized === "auth.openai.com" ||
    normalized === "auth0.openai.com"
  );
}

/** Keep the ChatGPT session, excluding sessions for sign-in providers. */
function chatGPTState(state) {
  return {
    cookies: state.cookies.filter((cookie) => allowedHost(cookie.domain)),
    // Keep session cookies and complete ChatGPT storage, but omit large
    // auth-site sign-in caches, which the live suite doesn't need.
    origins: state.origins.filter((origin) =>
      chatGPTHost(new URL(origin.origin).hostname),
    ),
  };
}

let context;
let input;
let chrome;
let chromeExited = false;

try {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  await chmod(privateDirectory, 0o700);
  // A stale endpoint must never point the next live run at an old browser.
  await rm(path.join(privateDirectory, "live-browser.json"), { force: true });
  chrome = launchManualChrome(await chromeExecutable(), profile);
  const cancelled = new AbortController();
  chrome.once("exit", () => {
    chromeExited = true;
    cancelled.abort();
  });
  chrome.once("error", () => {
    chromeExited = true;
    cancelled.abort();
  });
  console.log("A separate ordinary Google Chrome profile is open at ChatGPT.");
  console.log(
    "Sign in manually. No automation is attached and no extension is installed by this helper.",
  );
  console.log(
    "If verification keeps looping, close this window and stop; this helper does not bypass challenges or restart Chrome.",
  );
  input = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    await input.question(
      "When signed in and the chat editor is ready, press Enter here: ",
      {
        signal: cancelled.signal,
      },
    );
    if (chromeExited) throw new Error("The dedicated Chrome window closed.");
    if (!context) {
      const port = (
        await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
      if (!/^\d+$/.test(port))
        throw new Error("Chrome has no local debugging endpoint.");
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      context = browser.contexts()[0];
      context.on("close", () => cancelled.abort());
    }
    const page = context.pages().find((candidate) => {
      try {
        return chatGPTHost(new URL(candidate.url()).hostname);
      } catch {
        return false;
      }
    });
    if (!page)
      throw new Error(
        "Open ChatGPT in the dedicated Chrome window before confirming.",
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
    const composerReady = await page
      .locator("#prompt-textarea, form [contenteditable='true'], form textarea")
      .filter({ visible: true })
      .first()
      .isVisible();
    if (!authenticated || !composerReady) {
      console.log(
        "Sign-in is not ready yet. Finish signing in and open a chat, then try again.",
      );
      continue;
    }

    const state = chatGPTState(await context.storageState({ indexedDB: true }));
    await writeFile(authFile, JSON.stringify(state), { mode: 0o600 });
    await chmod(authFile, 0o600);
    console.log(
      "Authenticated session saved to .playwright/chatgpt-auth.json.",
    );
    console.log(
      "This local session file is private and must stay outside Git and CI artifacts.",
    );
    if (keepOpen) {
      const port = (
        await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
      const connectionFile = path.join(privateDirectory, "live-browser.json");
      await writeFile(
        connectionFile,
        JSON.stringify({ endpoint: `http://127.0.0.1:${port}` }),
        { mode: 0o600 },
      );
      await chmod(connectionFile, 0o600);
      input.close();
      input = undefined;
      console.log(
        "Leave this Chrome window open for the live tests. Close it when you are finished.",
      );
      await new Promise((resolve) => context.once("close", resolve));
    }
    break;
  }
} catch {
  console.error(
    "ChatGPT sign-in was not saved. Finish sign-in in the dedicated Chrome profile and rerun this command.",
  );
  console.error(
    "Install Google Chrome if needed, or close the existing dedicated test-profile window. If verification loops, stop and use a browser session the site accepts; no challenge bypass is attempted.",
  );
  process.exitCode = 1;
} finally {
  input?.close();
  await context?.close();
  if (chrome && !chromeExited) chrome.kill();
}
