# Changelog

Notable changes to the DataFog browser extension. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

Prototype: a Chrome extension that checks what you type into ChatGPT for sensitive data, on your device, before you send it.

### Added

- Text in the ChatGPT chat box on chatgpt.com is checked when you pause typing, and right away when you paste.
- A small DataFog badge in the chat box's bottom-right corner turns into a red count when something sensitive is found. Clicking it lists the types and counts, never the values. It stays in view while a long prompt is scrolled, and follows the chat box into a new chat.
- If DataFog can't check the text or redact it, the badge shows an orange `!` instead of checking forever. Its panel shows an error code to report, and the extension logs only that code, never the text. Reloading the page tries again.
- **Redact** replaces each found value in the chat box with a label such as `[EMAIL]`, editing only those values, so it stays quick on a long prompt. **Dismiss** hides the warning until the text changes. The extension never sends a message for you.
- API keys, bearer tokens, credential URIs, credit card numbers, email addresses, JWTs, NPIs, private keys, SSNs, and US routing numbers are checked by default. Phone numbers, dates, ZIP codes, and IP addresses can be turned on in settings, which note what each one may flag by mistake.
- A settings page to turn checking on or off, choose what to look for, and list exact values to always allow, such as your own work email.
- The toolbar icon shows `!` when the chat box can't be found, so you know the page isn't being checked.
- A DataFog tab on the right edge of chatgpt.com opens a DataFog side panel, as does the toolbar icon. The panel has a button to open settings.

### Security

- Detection runs on your device with [DataFog Core](https://github.com/DataFog/datafog-core) (`@datafog/wasm` 1.0.0). The extension makes no network requests.
- Permissions requested: `storage`, for settings; `sidePanel`, for the DataFog panel; and `offscreen`, to keep Core running while the panel is closed.
- Errors carry codes only, never text from the chat box.

### Known limitations

- Works on chatgpt.com only.
- Redaction is one way: labels such as `[EMAIL]` can't be turned back into the original values.
- Detection is pattern-based, so names and street addresses are not detected.
- The allowlist is saved unencrypted in Chrome's extension storage.
- Finding the chat box depends on ChatGPT's page structure, which can change without notice.
