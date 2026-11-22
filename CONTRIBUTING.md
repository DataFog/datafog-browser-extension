# Contributing

Contributions are welcome. Each pull request describes:

- **Summary:** what the change does, in a sentence or two.
- **What changed:** the main changes, file by file or feature by feature.
- **Why:** the problem it solves or the reason for it.
- **Limitations:** anything it leaves out or doesn't handle, if any.

It also follows the [changelog policy](#changelog).

## Setup

You need Node.js 24 (see `.nvmrc`) and Google Chrome.

```sh
npm ci
npm run build
```

`dist/` is the extension. To load it, open `chrome://extensions`, turn on
**Developer mode**, choose **Load unpacked** and select `dist/`. After a
rebuild, click the extension's reload button there and reload the chat tab.
`npm run watch` rebuilds on each change.

To try the badge without a chat site, serve `harness/` (for example
`python3 -m http.server --directory harness`) and open `harness.html`.

## Code map

- `src/site.ts`: each chat site's profile, with its chat box, send button,
  answers and badge size. Adding a site means adding a profile there and its
  host to `manifest.json`.
- `src/content.ts`: watches the chat box and scans 400 ms after typing stops,
  or right away on paste. `src/badge.ts` draws the circle and draft popup in a shadow root. `src/page.ts` watches for sends and attached files.
- `src/background.ts`: the service worker. It opens the offscreen document and
  passes requests to it with the current settings.
- `src/offscreen.ts`: runs DataFog Core. `src/detect.ts` builds Core's scan
  settings, and `src/model.ts` runs the name and address model in a Worker.
- `src/vault.ts` and `src/device.ts`: the encrypted vault, through FogVault and
  Core's adapter, and the automatic local device key.
- `src/panel.ts`: saved originals, rules and preferences in the sidebar.
  `src/originals.ts` owns independent answer controls and local original display.
- `src/options.ts` and `src/settings.ts`: the settings page and stored
  settings.

Prompt text stays inside the extension, and the extension makes no network
requests. Keep it that way, and keep values out of logs and error messages.

## Tests

Run these before opening a PR:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` runs the unit tests with the real Core WebAssembly.

The browser tests load the built extension into Google Chrome and check each
site against a stand-in page, so they need no accounts:

```sh
npx playwright install chrome
npm run test:integration
```

CI runs them in Chrome on Linux, macOS and Windows, and in Microsoft Edge on
Windows. `E2E_BROWSER=msedge` runs them in Edge locally. Failed runs upload a
Playwright report; `npm run test:e2e:report` opens a local one.

Maintainers can also run a live suite against chatgpt.com with a ChatGPT test
account. It's optional and doesn't run in CI:

```sh
npm run test:live:auth -- --keep-open
npm run test:e2e:live
```

The first command is optional when you already have a signed-in Chrome exposing a localhost debugging endpoint. To use that existing browser, set `CHATGPT_CDP_ENDPOINT=http://127.0.0.1:9333` (use its actual port) and `LIVE_BROWSER_CONTEXT_ID` to the verified browser-context ID of its signed-in ChatGPT tab, then run `npm run test:e2e:live`. Obtain the ID from CDP `Target.getTargetInfo`, and confirm the chosen profile with `chrome://version` in an owned tab opened from that tab. Rediscover it after restarting Chrome; do not reuse an ID from another profile. Both variables must also be present when committing with the live hook. When the hook runs in an isolated worktree but the loaded extension belongs to another checkout, also supply `LIVE_ORIGINAL_EXTENSION_ID` and its absolute `LIVE_ORIGINAL_EXTENSION_PATH` together. The runner validates that exact pair and owns suspension/restoration once; do not wrap the hook in a second suspension helper. The runner opens test and extension-management pages through that verified profile's opener, rejects context mismatches, builds in an owned temporary directory, temporarily disables only this checkout's existing unpacked `dist/` build, preserves its vault, and restores its enabled state in `finally`. Tests install a separate disposable copy and remove only that copy afterward, including failed startup. Other datafog installations are rejected. Existing tabs are not reloaded; an older extension may need a manual tab reload after being reenabled.

For a separate sign-in profile, the first command launches installed Chrome directly. It attaches automation only after you confirm that sign-in and the editor are ready, and does not install the extension during authentication. Leave that window open for the second command. Complete any human verification yourself. If verification loops, stop rather than repeatedly relaunching; this workflow does not bypass challenges. Set `CHROME_EXECUTABLE_PATH` if Chrome is installed outside a standard location.

`npm run hooks:install` adds a pre-commit hook that runs the live suite before each commit.

## Changelog

A PR that changes what users see, such as behavior, settings, permissions or
supported sites, adds a short entry under `[Unreleased]` in `CHANGELOG.md`.
Describe the change for users, not the commits. CI checks for the entry:

```sh
node scripts/check-changelog.mjs --base origin/main
```

A PR with no user-facing effect, such as tests or refactoring, can skip it
with the `no-changelog` label and a line in the PR description:

```text
Changelog exemption: Adds tests without changing extension behavior.
```

Dependabot's dependency updates are exempt automatically. When one changes
what users see, such as a Core update with better detection, add an entry by
hand.

## Releasing

1. In a PR, set the new version in `manifest.json` and `package.json`
   (`npm version <version> --no-git-tag-version` updates `package.json` and
   its lock file). Rename `## [Unreleased]` in `CHANGELOG.md` to
   `## [<version>] - YYYY-MM-DD`, and add an empty `## [Unreleased]` above it.
   Label the PR `no-changelog`, with `Changelog exemption: Release <version>.`
2. Check it locally:

   ```sh
   node scripts/check-release.mjs --tag v<version>
   npm run package
   ```

   `npm run package` writes `release/datafog-<version>.zip`, and needs the
   `zip` command, as on macOS and Linux.

3. After the PR merges, tag the merge commit on `main` and push the tag:

   ```sh
   git switch main && git pull --ff-only
   git tag v<version>
   git push origin v<version>
   ```

4. The Release workflow checks the tag against the versions and changelog,
   runs the checks, and publishes a GitHub release with the zip and that
   version's changelog section. Upload the zip from the release to the Chrome
   Web Store developer dashboard.

## Reporting problems

Email bugs and security issues to help@datafog.ai. See
[SECURITY.md](SECURITY.md) for what counts as a vulnerability.
