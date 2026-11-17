# Changelog

Notable changes to the DataFog browser extension. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

The first release: a Chrome extension that checks what you type into AI chat sites for sensitive data, on your device, before you send it.

### Added

- Runs on ChatGPT, Claude, Gemini, Grok and DeepSeek. Text in the chat box is checked when you pause typing, and right away when you paste.
- Finds account numbers, API keys, bearer tokens, credential URIs, credit card numbers, email addresses, JWTs, mailing addresses, names, NPIs, private keys, SSNs, street addresses and US routing numbers by default. Phone numbers, dates, ZIP codes, IP addresses and UUIDs can be turned on in the settings. Names and mailing addresses come from a small model that runs on your device.
- A badge beside the chat box shows pulsing dots while checking and a red count when something is found. Clicking it lists the types and counts, never the values.
- **Redact** replaces each found value with its type, such as `[EMAIL]`, with **Undo** and **Redo**. **Dismiss** hides the warning until the text changes.
- **Pseudonymize** replaces each found value with a marker, such as `[[EMAIL_7KQ4ZM]]`, after you review the values and markers in the side panel. The same value always gets the same marker.
- An encrypted vault on your device keeps the originals behind markers. It locks when Chrome closes, after 15 minutes without use, or with **Lock**. **Remember this device for 30 days** unlocks it without your password, and **Delete vault** starts over if the password is forgotten.
- **Restore latest answer** shows the original values in place of the markers in the chat's latest answer, with **Hide originals** and **Copy restored answer**.
- **Always allow** values DataFog never flags, such as your own work email, and **Always flag** phrases it always finds, such as a project or client name, from the settings or the side panel. **Not sensitive** in a review skips a value while the vault is unlocked. Adding to a list confirms it, and changing either list, the types to look for or a Not sensitive choice checks open chats again right away.
- Settings to choose what to look for and turn checking on or off for each site.
- An optional setting, off by default, holds a message with sensitive data once when you send it, with **Send anyway**.
- Warnings when a file is attached, since files aren't checked, and when the chat box can't be found, with **Update now** when a DataFog update is waiting. If a check fails, the badge shows an error code to report to help@datafog.ai.
- A DataFog side panel, opened from a tab on the page's right edge or the toolbar icon, that follows your browser's light or dark theme.

### Security

- Detection runs on your device with [DataFog Core](https://github.com/DataFog/datafog-core) 1.6. The extension makes no network requests, and errors carry codes only, never your text.
- The vault uses FogVault through Core's adapter, with an Argon2 password key. The password and originals are never stored unencrypted or shown to the chat site's scripts.
- A remembered device uses a software key that can't be exported, so anyone who can use your Chrome profile within the 30 days can unlock the vault.
- Permissions requested: `storage` for settings, `sidePanel` for the DataFog panel, and `offscreen` to keep Core running while the panel is closed.
