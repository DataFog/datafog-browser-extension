# Contributing

Pull requests are welcome. For a large change, such as a new site or setting,
email help@datafog.ai first so the approach can be agreed before you build it.

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
  or right away on paste. `src/badge.ts` and `src/tab.ts` draw the badge and
  page tab in shadow roots. `src/page.ts` watches for sends and attached files.
- `src/background.ts`: the service worker. It opens the offscreen document and
  passes requests to it with the current settings.
- `src/offscreen.ts`: runs DataFog Core. `src/detect.ts` builds Core's scan
  settings, and `src/model.ts` runs the name and address model in a Worker.
- `src/vault.ts` and `src/device.ts`: the encrypted vault, through FogVault and
  Core's adapter, and the key for **Remember this device**.
- `src/panel.ts`: the side panel. `src/originals.ts` shows restored values in
  the chat's answer.
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

CI runs them on Linux, macOS and Windows. Failed runs upload a Playwright
report; `npm run test:e2e:report` opens a local one.

Maintainers can also run a live suite against chatgpt.com with a ChatGPT test
account. It's optional and doesn't run in CI:

```sh
npm run test:live:auth -- --keep-open
npm run test:e2e:live
```

The first command opens a separate Chrome profile to sign in to; leave it open
for the second. `npm run hooks:install` adds a pre-commit hook that runs the
live suite before each commit.

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

## Reporting problems

Email bugs and security issues to help@datafog.ai. See
[SECURITY.md](SECURITY.md) for what counts as a vulnerability.
