# DataFog browser extension (prototype)

Checks what you type into ChatGPT for sensitive data, on your device, using [DataFog Core](https://github.com/DataFog/datafog-core)'s WebAssembly build (`@datafog/wasm`). A badge beside the chat box shows what was found; click it to **Redact** the values, **Pseudonymize** them, or **Dismiss** the warning.

Pseudonymize replaces each value with a marker such as `[[EMAIL_7KQ4ZM]]` and keeps the original in an encrypted vault on your device, so the same value always gets the same marker. You review the values and markers in the side panel before anything changes. **Restore latest answer** in the side panel shows the original values in place of the markers in ChatGPT's latest answer, until you choose **Hide originals** or the vault locks.

Prototype only: ChatGPT only, Core's default types, no file uploads, and restore covers only the latest answer.

## Build

```bash
npm install
npm run build
```

`dist/` is the extension. `harness/` is a local test page.

## Load in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and choose `dist/`.
3. Open chatgpt.com and type, for example: `my email is jane@example.com and card 4111 1111 1111 1111`.

Click the DataFog tab on the right edge of chatgpt.com, or the toolbar icon, to open the DataFog side panel. Its **Settings** button opens the settings: types to detect, an exact-match allowlist, and an on/off switch. A `!` on the toolbar icon means the chat box wasn't found and the page isn't protected.

## How it works

- `src/content.ts` watches the chat box. It scans 400 ms after you stop typing, and right away on paste. Stale results are dropped.
- `src/background.ts` opens an offscreen document and passes the content script's requests to it, with the current settings.
- `src/offscreen.ts` runs Core and answers with counts by type. It stays loaded while the side panel is closed, unlike the service worker, which Chrome stops when idle. Counts come from Core's `transform`, so a value two detectors match counts once.
- `src/vault.ts`, in the offscreen document, keeps the vault: [FogVault](https://github.com/DataFog/fogvault) encrypts the workspace in IndexedDB, and Core's adapter (`@datafog/core-fogvault-browser`) owns the workspace that maps values to markers. It saves an approved review before the chat box changes, and locks after 15 minutes without use.
- `src/device.ts` keeps the key for **Remember this device**: a WebCrypto key that can't be exported, in the extension's IndexedDB, wraps the vault's seed in a FogVault device slot for 30 days. Forgetting the device or letting it expire deletes the key, so the slot can't be used.
- `src/originals.ts` shows restored values in ChatGPT's answer, each in a closed shadow root so the page's scripts and text still see only the marker.
- `src/panel.ts` runs the side panel: creating, unlocking, locking and resetting the vault, reviewing Pseudonymize, and restoring the latest answer. Only extension pages can send it vault requests; the password never reaches the chat site.
- `src/page.ts` watches the page for sends and attached files.
- `src/badge.ts` draws the badge in a shadow root, isolated from the page. `src/tab.ts` draws the page tab the same way.
- Redact edits the chat box through `execCommand`, so ChatGPT's editor keeps the change.
- Prompt text stays inside the extension. There are no network requests.

## Checks

```bash
npm run typecheck
npm test   # unit tests in Node, with the real Core wasm
```

To try the badge without ChatGPT, serve `harness/` (for example `python3 -m http.server --directory harness`) and open `harness.html`.

## Security

Report vulnerabilities through [SECURITY.md](SECURITY.md), rather than a public issue.

## License

[MIT](LICENSE). Built by [DataFog](https://datafog.ai).
