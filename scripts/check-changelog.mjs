/**
 * Require a changelog entry, or an explicit exemption, across a whole PR.
 *
 * Compares HEAD with its merge base on the PR's target branch, so an entry
 * committed earlier in the PR counts and stacked PRs are checked against
 * their own base.
 *
 * Usage: node scripts/check-changelog.mjs [--base <ref>] [--event <path>]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const LABEL = "no-changelog";

/**
 * Whether a CHANGELOG.md diff adds any real text.
 *
 * Headings, blank lines and bare bullets don't count.
 *
 * @param patch Output of `git diff --unified=0 -- CHANGELOG.md`.
 * @returns True if at least one substantive line was added.
 */
export function hasEntry(patch) {
  return patch.split("\n").some((line) => {
    if (!line.startsWith("+") || line.startsWith("+++")) return false;
    const text = line.slice(1).trim();
    return text !== "" && !text.startsWith("#") && text !== "-";
  });
}

/**
 * The reason a PR is exempt from the changelog.
 *
 * @param pullRequest The `pull_request` object from the GitHub event.
 * @returns The reason, or null if the PR isn't labeled for an exemption.
 * @throws If the PR is labeled but its description gives no reason.
 */
export function exemption(pullRequest) {
  const labeled = (pullRequest.labels ?? []).some(
    (label) => label.name === LABEL,
  );
  if (!labeled) return null;
  const match = /^Changelog exemption:[ \t]*(\S[^\r\n]*)/m.exec(
    pullRequest.body ?? "",
  );
  if (!match) {
    throw new Error(
      `The ${LABEL} label requires 'Changelog exemption: <reason>' in the PR description.`,
    );
  }
  return match[1].trim();
}

/**
 * Run a git command in the current directory.
 *
 * @param args The git arguments.
 * @returns Its standard output.
 */
function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Check the current branch against its base.
 *
 * @param argv Command-line arguments, without the node and script paths.
 * @returns The exit code: 0 if the policy is met, 1 otherwise.
 */
export function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      base: {
        type: "string",
        default: process.env.CHANGELOG_BASE || "origin/main",
      },
      event: { type: "string" },
    },
  });

  try {
    const base = git("merge-base", values.base, "HEAD").trim();
    if (!git("diff", "--name-only", base, "HEAD").trim()) {
      console.log("No changes to check.");
      return 0;
    }

    if (values.event) {
      const reason = exemption(
        JSON.parse(readFileSync(values.event, "utf8")).pull_request,
      );
      if (reason) {
        console.log(`Changelog exemption: ${reason}`);
        return 0;
      }
    }

    const patch = git(
      "diff",
      "--no-ext-diff",
      "--unified=0",
      base,
      "HEAD",
      "--",
      "CHANGELOG.md",
    );
    if (hasEntry(patch)) {
      console.log("Changelog entry found.");
      return 0;
    }
    console.error(
      "Add an entry to CHANGELOG.md for this PR. For a change with no user-facing effect, " +
        "see CONTRIBUTING.md for how to request an exemption.",
    );
  } catch (error) {
    // A missing base ref fails the check rather than passing silently
    console.error(`Cannot check the changelog: ${error.message}`);
    console.error("Fetch the PR base, or set CHANGELOG_BASE to its local ref.");
  }
  return 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
