/**
 * Tests for the release check.
 *
 * Usage: npm test
 */

import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  changelogSection,
  checkVersions,
  tagVersion,
} from "./check-release.mjs";

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

## [1.1.0] - 2026-12-01

### Fixed

- A fix.

## [1.0.0] - 2026-11-20

The first release.

### Added

- A feature.
`;

describe("tagVersion", () => {
  test("reads the version from a v tag", () => {
    assert.equal(tagVersion("v1.0.0"), "1.0.0");
  });

  test("refuses other tags", () => {
    for (const tag of ["1.0.0", "v1.0", "v1.0.0-rc.1", "release"])
      assert.throws(() => tagVersion(tag), /should look like v1\.0\.0/);
  });
});

describe("checkVersions", () => {
  test("passes when both files match", () => {
    checkVersions("1.0.0", { version: "1.0.0" }, { version: "1.0.0" });
  });

  test("names the file that doesn't match", () => {
    assert.throws(
      () => checkVersions("1.0.1", { version: "1.0.1" }, { version: "1.0.0" }),
      /package\.json has version 1\.0\.0, not 1\.0\.1/,
    );
    assert.throws(
      () => checkVersions("1.0.1", { version: "1.0.0" }, { version: "1.0.1" }),
      /manifest\.json/,
    );
  });
});

describe("changelogSection", () => {
  test("returns a version's section up to the next heading", () => {
    assert.equal(changelogSection(CHANGELOG, "1.1.0"), "### Fixed\n\n- A fix.");
  });

  test("returns the last section to the end", () => {
    assert.equal(
      changelogSection(CHANGELOG, "1.0.0"),
      "The first release.\n\n### Added\n\n- A feature.",
    );
  });

  test("requires the section", () => {
    assert.throws(
      () => changelogSection(CHANGELOG, "2.0.0"),
      /no "## \[2\.0\.0\]" section/,
    );
  });

  test("doesn't match a version that only starts the same", () => {
    assert.throws(
      () => changelogSection("## [1.0.00] - 2026-11-20\n\n- A.", "1.0.0"),
      /no "## \[1\.0\.0\]" section/,
    );
  });

  test("requires a date", () => {
    assert.throws(
      () => changelogSection("## [1.0.0]\n\n- A feature.", "1.0.0"),
      /needs a date/,
    );
  });

  test("requires some text", () => {
    assert.throws(
      () => changelogSection("## [1.0.0] - 2026-11-20\n\n## [0.9.0]", "1.0.0"),
      /is empty/,
    );
  });
});
