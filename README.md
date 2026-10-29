# DataFog browser extension (prototype)

Checks what you type into ChatGPT for sensitive data, on your device, using [DataFog Core](https://github.com/DataFog/datafog-core)'s WebAssembly build (`@datafog/wasm`). A badge beside the chat box shows what was found; click it to **Redact** the values or **Dismiss** the warning. The extension never touches ChatGPT's send button.

Prototype only: ChatGPT only, Core's default types, no file uploads, no pseudonymization.

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

Click the toolbar icon for settings: types to detect, an exact-match allowlist, and an on/off switch. A `!` on the toolbar icon means the chat box wasn't found and the page isn't protected.

## How it works

- `src/content.ts` watches the chat box. It scans 400 ms after you stop typing, and right away on paste. Stale results are dropped.
- `src/background.ts` runs Core in the service worker and answers with counts by type. Counts come from Core's `transform`, so a value two detectors match counts once.
- `src/badge.ts` draws the badge in a shadow root, isolated from the page.
- Redact edits the chat box through `execCommand`, so ChatGPT's editor keeps the change.
- Prompt text stays inside the extension. There are no network requests.

## Checks

```bash
npm run typecheck
npm test   # unit tests in Node, with the real Core wasm
```

To try the badge without ChatGPT, serve `harness/` (for example `python3 -m http.server --directory harness`) and open `harness.html`.

## License

[MIT](LICENSE). Built by [DataFog](https://datafog.ai).
