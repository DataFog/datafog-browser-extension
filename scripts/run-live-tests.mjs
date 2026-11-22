/** Run the authenticated suite locally against an already-open Chrome. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { withSuspendedLocalExtension } from "./live-extension-suspension.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function git(args, directory = root) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Hash the actual working files; ignored sessions and generated outputs stay out. */
export function sourceFingerprint(directory = root) {
  const files = new Set(
    execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
      .split("\0")
      .filter(Boolean),
  );
  const hash = createHash("sha256");
  for (const name of [...files].toSorted((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const filename = path.join(directory, name);
    let info;
    try {
      info = lstatSync(filename);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash.update(JSON.stringify([name, "deleted"]));
      hash.update("\0");
      continue;
    }
    const kind = info.isSymbolicLink()
      ? "symlink"
      : info.isFile()
        ? "file"
        : "directory";
    const content = info.isSymbolicLink()
      ? Buffer.from(readlinkSync(filename))
      : info.isFile()
        ? readFileSync(filename)
        : Buffer.alloc(0);
    hash.update(JSON.stringify([name, kind, info.mode, content.length]));
    hash.update("\0");
    hash.update(content);
  }
  return `sha256:${hash.digest("hex")}`;
}

/** Resolve only an explicit or locally saved browser; never launch Chrome here. */
function browserEndpoint() {
  let endpoint = process.env.CHATGPT_CDP_ENDPOINT;
  try {
    if (!endpoint && process.env.CHATGPT_USE_OPEN_PROFILE === "1") {
      const port = readFileSync(
        path.join(root, ".playwright/live-profile/DevToolsActivePort"),
        "utf8",
      ).split("\n")[0];
      endpoint = `http://127.0.0.1:${port}`;
    }
    if (!endpoint)
      endpoint = JSON.parse(
        readFileSync(path.join(root, ".playwright/live-browser.json"), "utf8"),
      ).endpoint;
  } catch {
    throw new Error(
      "No open test Chrome is configured. Run npm run test:live:auth -- --keep-open, finish sign-in, then run with CHATGPT_USE_OPEN_PROFILE=1. Leave Chrome open; complete any human verification yourself.",
    );
  }
  if (typeof endpoint !== "string")
    throw new Error("The saved live browser configuration needs an endpoint.");
  const url = new URL(endpoint);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "The live browser endpoint must be a localhost HTTP origin.",
    );
  return url.origin;
}

export function runNode(args, env = process.env) {
  // Keep CDP event handling alive while the child tests create page targets.
  // A synchronous child would leave this client's auto-attached targets paused.
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (status, signal) => {
      if (status === 0) resolve();
      else
        reject(
          new Error(
            `The local live check did not pass${signal ? ` (${signal})` : ""}.`,
          ),
        );
    });
  });
}

/** Build only into a newly owned directory, never an installed unpacked path. */
export async function withIsolatedLiveBuild(env, run, build = runNode) {
  const directory = await mkdtemp(path.join(tmpdir(), "datafog-live-build-"));
  try {
    await build(
      [path.join(root, "build.mjs"), "--output-root", directory],
      env,
    );
    return await run({ ...env, DATAFOG_TEST_BUILD_ROOT: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runLiveTests(args = []) {
  if (process.env.CI && process.env.CI !== "false")
    throw new Error(
      "The logged-in ChatGPT suite is a local check, not a CI job.",
    );
  const endpoint = browserEndpoint();
  try {
    const response = await fetch(`${endpoint}/json/version`);
    if (!response.ok) throw new Error("Chrome did not answer");
  } catch {
    throw new Error(
      "The configured Chrome is not available. Open the test browser, sign in and leave its window open before committing. Chrome will not be restarted automatically.",
    );
  }

  const fingerprint = sourceFingerprint();
  const runId = randomUUID();
  const env = {
    ...process.env,
    CHATGPT_CDP_ENDPOINT: endpoint,
    LIVE_TEST_RUN_ID: runId,
    LIVE_TEST_CODE_FINGERPRINT: fingerprint,
    LIVE_TEST_COMMIT_BASE: git(["rev-parse", "HEAD"]),
    LIVE_TEST_STAGED_TREE: git(["write-tree"]),
    LIVE_TEST_ARGUMENTS: JSON.stringify(args),
    LIVE_TEST_SCOPE: args.every((arg) => arg === "--headed")
      ? "full"
      : "selected",
  };
  await withSuspendedLocalExtension(
    endpoint,
    root,
    async (originalId, originalPath, browserContextId) => {
      env.LIVE_BROWSER_CONTEXT_ID = browserContextId;
      if (originalId) {
        env.LIVE_SUSPENDED_EXTENSION_ID = originalId;
        env.LIVE_SUSPENDED_EXTENSION_PATH = originalPath;
      }
      await withIsolatedLiveBuild(env, async (buildEnv) =>
        runNode(
          [
            require.resolve("@playwright/test/cli"),
            "test",
            "--config=playwright.live.config.ts",
            ...args,
          ],
          buildEnv,
        ),
      );
    },
    undefined,
    {
      id: process.env.LIVE_SUSPENDED_EXTENSION_ID,
      path: process.env.LIVE_SUSPENDED_EXTENSION_PATH,
      contextId: process.env.LIVE_BROWSER_CONTEXT_ID,
      originalId: process.env.LIVE_ORIGINAL_EXTENSION_ID,
      originalPath: process.env.LIVE_ORIGINAL_EXTENSION_PATH,
    },
  );

  const receiptPath = path.join(root, ".playwright/live-receipt.json");
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch {
    throw new Error("The live run produced no verifiable local receipt.");
  }
  if (receipt.runId !== runId || receipt.status !== "PASS")
    throw new Error("The current live run has no passing local receipt.");
  if (sourceFingerprint() !== fingerprint)
    throw new Error(
      "Working files changed while the live tests ran. Run the check again against the code you intend to commit.",
    );
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length === 3 && process.argv[2] === "--fingerprint")
      console.log(sourceFingerprint());
    else await runLiveTests(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "The live check failed.",
    );
    process.exitCode = 1;
  }
}
