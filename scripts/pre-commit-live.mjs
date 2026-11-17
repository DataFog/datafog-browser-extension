/** Git invokes the complete local live suite, without selection arguments. */
import { execFileSync } from "node:child_process";

import { runLiveTests } from "./run-live-tests.mjs";

/**
 * Whether the working files differ from what's staged, so the suite would
 * test code other than the commit.
 *
 * @returns True if a tracked file has unstaged changes or a file is untracked.
 */
function unstagedChanges() {
  const status = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return status
    .split("\n")
    .some((line) => line[1] !== undefined && line[1] !== " ");
}

try {
  if (unstagedChanges())
    throw new Error(
      "Working files differ from the staged commit, so the live suite would test other code. Stage or stash those changes first, for example with git stash --keep-index --include-untracked.",
    );
  await runLiveTests();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "The local live check failed.",
  );
  console.error("Commit stopped: the complete local live suite must pass.");
  process.exitCode = 1;
}
