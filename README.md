# DataFog browser extension

Checks what you type into ChatGPT, Claude, Gemini, Grok and DeepSeek for sensitive data, including names and mailing addresses, on your device, using [DataFog Core](https://github.com/DataFog/datafog-core)'s WebAssembly build (`@datafog/wasm`). A badge beside the chat box shows what was found; click it to **Redact** the values, **Pseudonymize** them, or **Dismiss** the warning.

Pseudonymize replaces each value with a marker such as `[[EMAIL_7KQ4ZM]]` and keeps the original in an encrypted vault on your device, so the same value always gets the same marker. You review the values and markers in the side panel before anything changes, and can mark a value **Not sensitive** so DataFog leaves it as is from then on. **Restore latest answer** in the side panel shows the original values in place of the markers in the chat's latest answer, until you choose **Hide originals** or the vault locks.

Limits: it runs only on ChatGPT, Claude, Gemini, Grok and DeepSeek, doesn't check file uploads, and restores only the latest answer.

## Build

```bash
npm install
npm run build
```

`dist/` is the extension. `harness/` is a local test page.

## Load in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and choose `dist/`.
3. Open chatgpt.com, claude.ai, gemini.google.com, grok.com or chat.deepseek.com and type, for example: `my email is jane@example.com and card 4111 1111 1111 1111`.

Click the DataFog tab on the right edge of the page, or the toolbar icon, to open the DataFog side panel, which also lists the values to always allow and the phrases to always flag, with Add and Remove. Its **Settings** button opens the settings: types to detect, an exact-match allowlist, an Always flag list of your own phrases, and a checkbox for each site to check. A `!` on the toolbar icon means the chat box wasn't found and the page isn't protected.

## How it works

- `src/site.ts` holds what each chat site needs: where its chat box, send button and answers are, and the badge's size and shape. On sites whose empty chat box is the same height in every chat, the badge measures it instead. Adding a site means adding a profile there and its host to `manifest.json`.
- `src/content.ts` watches the chat box. It scans 400 ms after you stop typing, and right away on paste. Stale results are dropped.
- `src/background.ts` opens an offscreen document and passes the content script's requests to it, with the current settings. It also saves the version of an update Chrome has downloaded, which `src/update.ts` reads to offer Update now when the chat box can't be found.
- `src/offscreen.ts` runs Core and answers with counts by type. It stays loaded while the side panel is closed, unlike the service worker, which Chrome stops when idle. Counts come from Core's `transform`, so a value two detectors match counts once.
- `src/detect.ts` sets Core's `detect_uuid` switch or German locale when UUID or a German type is chosen, since choosing the type alone doesn't turn it on in Core. Settings offer every type Core finds in text except the German identifiers, which are supported but not yet offered.
- `src/model.ts` finds names and mailing addresses with the model bundled in Core, in its own Worker, one scan at a time. It runs only while Name or Mailing address is selected; every other type uses Core's rules.
- `src/vault.ts`, in the offscreen document, keeps the vault: [FogVault](https://github.com/DataFog/fogvault) encrypts the workspace in IndexedDB, and Core's adapter (`@datafog/core-fogvault-browser`) owns the workspace that maps values to markers. It saves an approved review before the chat box changes, and locks after 15 minutes without use unless the device is remembered. Values marked not sensitive are saved as Core policy choices in the same workspace, so Core leaves them out of reviews; while unlocked, the offscreen document also drops them from the badge's counts and Redact.
- `src/device.ts` keeps the key for **Remember this device**: a WebCrypto key that can't be exported, in the extension's IndexedDB, wraps the vault's seed in a FogVault device slot for 30 days. Forgetting the device or letting it expire deletes the key, so the slot can't be used.
- `src/originals.ts` shows restored values in the chat's answer, each in a closed shadow root so the page's scripts and text still see only the marker.
- `src/panel.ts` runs the side panel: creating, unlocking, locking and deleting the vault, reviewing Pseudonymize, listing values marked not sensitive, and restoring the latest answer. Only extension pages can send it vault requests; the password never reaches the chat site.
- `src/page.ts` watches the page for sends and attached files.
- `src/badge.ts` draws the badge in a shadow root, isolated from the page. `src/tab.ts` draws the page tab the same way.
- Redact edits the chat box through `execCommand`, so the site's editor keeps the change.
- Prompt text stays inside the extension. There are no network requests.

## Checks

```bash
npm run typecheck
npm test   # unit tests in Node, with the real Core wasm
npx playwright install chrome
npm run test:integration  # extension integration tests in Google Chrome
```

Extension integration tests run on pull requests to `main`, pushes to `main`, and manual
CI dispatches on Linux, macOS, and Windows. See the [case coverage and release
smoke checks](docs/regression-testing.md) for the boundaries of automated coverage,
including live ChatGPT authentication and native input methods. Failed browser
runs upload an HTML report and traces; `npm run test:e2e:report` opens a local report.

The live, logged-in suite runs locally before commits:

```sh
npm run hooks:install  # installs the repository-local pre-commit hook
npm run test:live:auth -- --keep-open  # sign in once; leave test Chrome open
npm run test:e2e:live  # run the same live check manually
```

The hook uses the already-running Chrome window and blocks the commit unless the
complete configured live suite passes. Each run prints and saves a receipt in
`.playwright/live-receipt.json` and `.playwright/live-receipt.txt`, including test
statuses, Chrome/platform details, the working-tree code fingerprint and staged
tree hash. Tests execute working files, so the hook stops the commit first if
any differ from what's staged.
The existing PR checks remain account-free, and authenticated live tests do not
run in CI. See [local live setup and receipts](docs/regression-testing.md#local-live-suite-and-pre-commit-hook)
for browser connection options and proof boundaries.

To try the badge without ChatGPT, serve `harness/` (for example `python3 -m http.server --directory harness`) and open `harness.html`.

## Security

Report problems and vulnerabilities to help@datafog.ai, rather than in a public issue. See [SECURITY.md](SECURITY.md) for what counts as a vulnerability.

## License

[MIT](LICENSE). Built by [DataFog](https://datafog.ai).
