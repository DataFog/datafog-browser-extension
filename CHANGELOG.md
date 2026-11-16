# Changelog

Notable changes to the DataFog browser extension. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

Prototype: a Chrome extension that checks what you type into ChatGPT for sensitive data, on your device, before you send it.

### Added

- Text in the ChatGPT chat box on chatgpt.com is checked when you pause typing, and right away when you paste.
- A small DataFog badge just outside the chat box shows pulsing dots from the moment you type until the text has been checked, and turns into a red count when something sensitive is found. Clicking it lists the types and counts, never the values. It stays in view while a long prompt is scrolled, and follows the chat box into a new chat.
- If DataFog can't check the text or redact it, the badge shows an orange `!` instead of checking forever. Its panel shows an error code, a link to report it, and the help email, and the extension logs only that code, never the text. Reloading the page tries again. If Redact fails, the panel keeps listing what was found. After an extension update, it asks you to reload the page.
- **Redact** replaces each found value in the chat box with a label such as `[EMAIL]`, editing only those values, so it stays quick on a long prompt. **Undo** and **Redo** in the badge's panel reverse and repeat the last redaction, and grey out once the text changes. The panel stays open for them until you click elsewhere. **Dismiss** hides the warning until the text changes. The extension only sends a message when you ask it to.
- Account numbers, API keys, bearer tokens, credential URIs, credit card numbers, email addresses, JWTs, mailing addresses, names, NPIs, private keys, SSNs, street addresses, and US routing numbers are checked by default. Account numbers and street addresses are found only after a label such as "Account number:" or "Shipping address:". Names and mailing addresses are found by a small model bundled in Core, which runs on your device. Phone numbers, dates, ZIP codes, IP addresses, and UUIDs can be turned on in settings, which note what each one may flag by mistake.
- Attaching a file opens the badge's panel with a warning that files aren't protected, since DataFog only checks text in the chat box. It stays until the message is sent.
- **Pseudonymize** in the badge's panel replaces each found value with a marker such as `[[EMAIL_7KQ4ZM]]`, and the same value gets the same marker every time. The side panel shows each value and its marker for review, scrolling within a box past five values; **Replace in chat box** saves them to your vault, then edits the chat box. If the chat box or what DataFog checks for changed in the meantime, nothing is replaced. **Undo** puts the values back.
- **Not sensitive**, beside a value in the Pseudonymize review, leaves that value as is from then on: it drops out of the review, and while the vault is unlocked the badge and Redact skip it too, ignoring case and spacing. The side panel's Workspace section lists these values, and **Remove** has DataFog replace one again. Core has no "send as is" choice for the types DataFog checks, so this is the only per-value choice.
- A vault in the side panel keeps the originals encrypted on your device. Creating it shows a recovery key once, with a warning that losing both it and the password loses the vault. It locks after 15 minutes without use, when Chrome closes, or with **Lock**, and asks for your password to unlock. **Forgot password?** sets a new password with the recovery key, keeping the vault's values; the vault gets new keys, so the side panel shows a new recovery key once, and a remembered device needs remembering again. **Reset vault** deletes the vault and everything in it once you type RESET, without the password, so you can start over if both are lost.
- **Remember this device for 30 days**, when creating or unlocking the vault, unlocks it without your password when you pseudonymize, restore, or open the side panel, until 30 days after you chose it. **Lock** asks for your password next time but keeps the device remembered, and **Forget this device** stops it.
- **Restore latest answer** in the side panel shows the original values in place of the markers in ChatGPT's latest answer, highlighted. **Hide originals** puts the markers back, as does locking the vault, and **Copy restored answer** copies the answer with its values. Markers the vault can't restore stay as they are, and the panel says how many.
- An optional setting, off by default, holds a message when something sensitive is found, for the send button and Enter. The panel explains and offers **Send anyway**, and pressing send again also sends it. If DataFog can't check the text, the message stays held until you choose Send anyway.
- A settings page to turn checking on or off, choose what to look for, and list exact values to always allow, such as your own work email. With checking off, the badge doesn't show and nothing is checked; changing the setting takes effect in open ChatGPT tabs right away.
- The extension uses the new DataFog logo in the badge and page tab, and for its toolbar, extensions page and store icons.
- The toolbar icon shows `!`, and the page tab shows an orange dot, when the chat box can't be found, so you know the page isn't being checked. Both explain why on hover.
- A DataFog tab on the right edge of chatgpt.com opens and closes a DataFog side panel, and the toolbar icon opens it too. The panel follows your browser's light or dark theme, and has a button to open settings.

### Security

- Detection runs on your device with [DataFog Core](https://github.com/DataFog/datafog-core) (`@datafog/wasm` 1.5.0 or a later 1.x). The name and address model is compiled into Core, so nothing is downloaded. The extension makes no network requests.
- The vault uses FogVault (`@datafog/fogvault-browser` 0.1.0) through Core's adapter (`@datafog/core-fogvault-browser` 1.5.0 or a later 1.x), with an Argon2 password key. The password and original values stay in the side panel and the offscreen document, and are never stored unencrypted or sent to the chat site. Restored values show in the chat page inside closed shadow roots, so the page's scripts, its copy button and its text see only the markers.
- A remembered device uses an AES-GCM key generated by WebCrypto that can't be exported, kept in the extension's IndexedDB. It's a software key, not one held in hardware, so anyone who can use your Chrome profile within the 30 days can unlock the vault.
- Permissions requested: `storage`, for settings; `sidePanel`, for the DataFog panel; and `offscreen`, to keep Core running while the panel is closed.
- Errors carry codes only, never text from the chat box.

### Known limitations

- Works on chatgpt.com only.
- Redaction is one way: labels such as `[EMAIL]` can't be turned back into the original values.
- Restore covers only the latest answer, and restores any marker in the vault, not only ones sent in that chat. Values disappear if ChatGPT redraws the answer; choose Restore again.
- The first time you remember a device on a vault made before this option, the vault gets new keys and a new recovery key, which the side panel shows once. A vault holds up to 16 device slots, and forgotten devices keep theirs.
- Names and mailing addresses come from a model tuned for statements. In everyday chat text it misses some, finds only part of a name, or flags well-known names. Turn either off in settings. Other types are pattern-based.
- Settings saved before this version don't turn on names and mailing addresses; select them in settings.
- The allowlist is saved unencrypted in Chrome's extension storage.
- Finding the chat box depends on ChatGPT's page structure, which can change without notice.
