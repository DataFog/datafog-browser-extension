/** Sign in interactively; never collect or print the test account's credentials. */
import { chromium } from "@playwright/test";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

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
    // auth-site sign-in caches from the 48 KB GitHub Actions secret.
    origins: state.origins.filter((origin) =>
      chatGPTHost(new URL(origin.origin).hostname),
    ),
  };
}

let context;
let input;

try {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  await chmod(privateDirectory, 0o700);
  context = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--remote-debugging-port=0", "--enable-unsafe-extension-debugging"],
  });

  const extensionPath = path.join(root, "dist");
  try {
    await access(path.join(extensionPath, "manifest.json"));
    const installer = await context.browser().newBrowserCDPSession();
    try {
      await installer.send("Extensions.loadUnpacked", { path: extensionPath });
    } finally {
      await installer.detach();
    }
  } catch {
    console.log(
      "The sign-in profile is ready; build the extension before running live tests.",
    );
  }

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded" });
  await page.bringToFront();
  console.log("A separate Google Chrome profile is open at ChatGPT.");
  console.log("Sign in to the dedicated test account in that window.");

  input = createInterface({ input: process.stdin, output: process.stdout });
  const cancelled = new AbortController();
  context.on("close", () => cancelled.abort());
  for (;;) {
    await input.question(
      "When signed in and the chat editor is ready, press Enter here: ",
      {
        signal: cancelled.signal,
      },
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
    "If Chrome could not start, install it with `npx playwright install chrome`, or close the existing test-profile window.",
  );
  process.exitCode = 1;
} finally {
  input?.close();
  await context?.close();
}
