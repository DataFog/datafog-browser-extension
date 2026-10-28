/**
 * Tests for the changelog policy check.
 *
 * The end-to-end cases mirror datafog-mcp's tests/test_changelog.py, so both
 * checkers are held to the same behavior.
 *
 * Usage: node --test scripts/check-changelog.test.mjs
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { exemption, hasEntry, LABEL } from "./check-changelog.mjs";

const SCRIPT = fileURLToPath(new URL("./check-changelog.mjs", import.meta.url));

describe("hasEntry", () => {
  test("counts an added line of text", () => {
    assert.equal(hasEntry("+++ b/CHANGELOG.md\n+- Adds a side panel."), true);
  });

  test("ignores headings, blank lines and bare bullets", () => {
    assert.equal(hasEntry("+++ b/CHANGELOG.md\n+## [0.1.0]\n+\n+-\n+   "), false);
  });

  test("ignores removed lines", () => {
    assert.equal(hasEntry("--- a/CHANGELOG.md\n-- Old entry."), false);
  });

  test("handles an empty diff", () => {
    assert.equal(hasEntry(""), false);
  });
});

describe("exemption", () => {
  const labeled = { labels: [{ name: LABEL }] };

  test("is null without the label", () => {
    assert.equal(exemption({ labels: [], body: "Changelog exemption: tests only" }), null);
  });

  test("is null when labels or body are missing", () => {
    assert.equal(exemption({}), null);
  });

  test("returns the reason with the label", () => {
    assert.equal(exemption({ ...labeled, body: "Summary\n\nChangelog exemption:  Tests only. \n" }), "Tests only.");
  });

  test("requires a reason with the label", () => {
    assert.throws(() => exemption({ ...labeled, body: "Changelog exemption:   \n" }), /requires/);
    assert.throws(() => exemption({ ...labeled, body: null }), /requires/);
  });

  test("requires the line to start the reason", () => {
    assert.throws(() => exemption({ ...labeled, body: "See Changelog exemption: tests" }), /requires/);
  });
});

describe("check-changelog", () => {
  let dir;
  let repo;

  /**
   * Run git in the temporary repository.
   *
   * @param args The git arguments.
   * @returns Its standard output.
   */
  function git(...args) {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  }

  /**
   * Write a file in the temporary repository.
   *
   * @param path The file path, relative to the repository.
   * @param content The new contents.
   */
  function write(path, content) {
    writeFileSync(join(repo, path), content);
  }

  /** Change the tracked behavior file and stage it. */
  function stageBehavior() {
    write("behavior.txt", "changed\n");
    git("add", "behavior.txt");
  }

  /**
   * Run the checker against main.
   *
   * @param args Extra checker arguments.
   * @returns The exit status.
   */
  function check(...args) {
    return spawnSync(process.execPath, [SCRIPT, "--base", "main", ...args], { cwd: repo, encoding: "utf8" }).status;
  }

  /**
   * Write a PR event outside the repository, so it never counts as a change.
   *
   * @param pullRequest The `pull_request` payload.
   * @returns The event file path.
   */
  function event(pullRequest) {
    const path = join(dir, "event.json");
    writeFileSync(path, JSON.stringify({ pull_request: pullRequest }));
    return path;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "changelog-"));
    repo = join(dir, "repo");
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    write("CHANGELOG.md", "# Changelog\n\nExisting entry.\n");
    write("behavior.txt", "original\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("switch", "-q", "-c", "feature");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("an uncommitted entry does not cover committed behavior", () => {
    stageBehavior();
    git("commit", "-q", "-m", "behavior without entry");
    write("CHANGELOG.md", "# Changelog\n\nChanged output behavior.\n");
    assert.equal(check(), 1);
    git("add", "CHANGELOG.md");
    assert.equal(check(), 1);
    git("commit", "-q", "-m", "entry");
    assert.equal(check(), 0);
  });

  test("an entry in a previous commit covers later commits", () => {
    write("CHANGELOG.md", "# Changelog\n\nChanged output behavior.\n");
    git("add", "CHANGELOG.md");
    git("commit", "-q", "-m", "entry");
    stageBehavior();
    git("commit", "-q", "-m", "implementation");
    assert.equal(check(), 0);
  });

  for (const entry of ["", "# Changelog\n", "# Changelog\n\nExisting entry.\n\n"]) {
    test(`deletions, headings and blank additions do not count (${JSON.stringify(entry)})`, () => {
      stageBehavior();
      write("CHANGELOG.md", entry);
      git("add", "CHANGELOG.md");
      git("commit", "-q", "-m", "change without substantive entry");
      assert.equal(check(), 1);
    });
  }

  test("renaming the changelog does not count", () => {
    git("mv", "CHANGELOG.md", "history.md");
    git("commit", "-q", "-m", "rename changelog");
    assert.equal(check(), 1);
  });

  for (const [labels, body, expected] of [
    [[], "Changelog exemption: Tests only.", 1],
    [[{ name: LABEL }], "", 1],
    [[{ name: LABEL }], "Changelog exemption:   \nOther text", 1],
    [[{ name: LABEL }], "Changelog exemption: Regression tests only.", 0],
  ]) {
    test(`an exemption requires the label and a reason (${JSON.stringify({ labels, body })})`, () => {
      stageBehavior();
      git("commit", "-q", "-m", "change without entry");
      assert.equal(check("--event", event({ labels, body })), expected);
    });
  }

  test("a missing base or malformed event fails closed", () => {
    assert.equal(spawnSync(process.execPath, [SCRIPT, "--base", "missing"], { cwd: repo }).status, 1);
    stageBehavior();
    git("commit", "-q", "-m", "change");
    const path = join(dir, "event.json");
    writeFileSync(path, "invalid json");
    assert.equal(check("--event", path), 1);
  });

  test("an entry added only on the base does not cover the feature", () => {
    git("switch", "-q", "main");
    write("CHANGELOG.md", "# Changelog\n\nUnrelated base change.\n");
    git("add", "CHANGELOG.md");
    git("commit", "-q", "-m", "base entry");
    git("switch", "-q", "feature");
    stageBehavior();
    git("commit", "-q", "-m", "feature behavior");
    assert.equal(check(), 1);
  });

  test("no changes pass", () => {
    assert.equal(check(), 0);
  });
});
