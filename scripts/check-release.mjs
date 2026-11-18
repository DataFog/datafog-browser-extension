/**
 * Check that a release tag matches the extension's version and changelog, and
 * write that version's changelog section as the release notes.
 *
 * Usage: node scripts/check-release.mjs --tag v1.0.0 [--notes <path>]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/**
 * The version a release tag names.
 *
 * @param tag The tag, such as v1.0.0.
 * @returns The version, such as 1.0.0.
 * @throws If the tag isn't v followed by a version.
 */
export function tagVersion(tag) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) throw new Error(`Tag ${tag} should look like v1.0.0.`);
  return match[1];
}

/**
 * Check that the manifest and package.json carry the release's version.
 *
 * @param version The release's version.
 * @param manifest The parsed manifest.json.
 * @param pkg The parsed package.json.
 * @throws If either has another version.
 */
export function checkVersions(version, manifest, pkg) {
  for (const [file, found] of [
    ["manifest.json", manifest.version],
    ["package.json", pkg.version],
  ]) {
    if (found !== version)
      throw new Error(`${file} has version ${found}, not ${version}.`);
  }
}

/**
 * A version's section of the changelog: its text under
 * `## [version] - YYYY-MM-DD`, up to the next version's heading.
 *
 * @param changelog CHANGELOG.md's text.
 * @param version The version.
 * @returns The section's text, trimmed.
 * @throws If the section is missing, undated or empty.
 */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const escaped = version.replaceAll(".", "\\.");
  const heading = new RegExp(`^## \\[${escaped}\\](.*)$`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1)
    throw new Error(`CHANGELOG.md has no "## [${version}]" section.`);
  if (!/^ - \d{4}-\d{2}-\d{2}$/.test(heading.exec(lines[start])[1]))
    throw new Error(
      `CHANGELOG.md's [${version}] heading needs a date: ## [${version}] - YYYY-MM-DD.`,
    );
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("## "),
  );
  const section = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
  if (!section) throw new Error(`CHANGELOG.md's [${version}] is empty.`);
  return section;
}

/**
 * Read a JSON file.
 *
 * @param path The file.
 * @returns Its parsed contents.
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Check the release and write its notes.
 *
 * @param argv Command-line arguments, without the node and script paths.
 * @returns The exit code: 0 if the release is ready, 1 otherwise.
 */
export function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { tag: { type: "string" }, notes: { type: "string" } },
  });
  try {
    if (!values.tag) throw new Error("Pass the release tag with --tag.");
    const version = tagVersion(values.tag);
    checkVersions(version, readJson("manifest.json"), readJson("package.json"));
    const notes = changelogSection(
      readFileSync("CHANGELOG.md", "utf8"),
      version,
    );
    if (values.notes) writeFileSync(values.notes, `${notes}\n`);
    console.log(`Release ${version} is ready.`);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
