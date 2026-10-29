# Contributing

Install the development dependencies before making changes:

```sh
npm ci
```

## Changelog policy

Every PR that changes user-facing behavior must add a concise entry to the
unreleased version in `CHANGELOG.md`. This includes extension behavior,
defaults, settings, permissions, security, installation, and supported sites.
Describe what users will experience; do not copy commit messages or claim
unfinished features.

For example, a new permission belongs under `Security`, while support for a new
site belongs under `Added`. Keep the release marked `Unreleased` until the
release is ready.

Changelog enforcement runs only in CI after you push. CI checks the complete PR
against its actual target branch, including when PRs are stacked on other branches.
An entry committed earlier in the PR counts; later commits do not need duplicate
entries.

The changelog checker detects a text addition, not whether that text accurately
describes the change; reviewers must
check its substance. Missing base refs fail the check instead of silently passing.

## Changes with no user-facing effect

Tests, internal refactoring, and documentation cleanup can be exempted when they
do not change user-facing behavior. Add the `no-changelog` PR label and a line in
the PR description explaining why:

```text
Changelog exemption: Adds regression tests without changing extension behavior.
```

Both the label and a nonempty reason are required. Reviewers should confirm the
reason; the label alone is insufficient. CI reruns when the PR description or
labels change. Repository administrators should require the `Changelog policy`
status check in branch protection so failed checks prevent merging.

Run the regular quality checks before opening a PR:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
node scripts/check-changelog.mjs --base origin/main
```
