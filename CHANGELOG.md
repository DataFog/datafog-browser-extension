# Changelog

Notable changes to the datafog browser extension. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-11-22

- Choose Replace or Redact per finding and apply mixed batches atomically, saving only Replace originals with one Undo. Add compact aligned rows, neutral selected modes, accessible explanations and a contrasting Apply button; remove Keep as is, More and the popup sidebar shortcut. Open the sidebar from Chrome’s toolbar, with only one native brand header. Refresh onboarding clips and storyboard to match.

- Simplify Getting started to a manual slideshow with previous/next controls and dots, looping clips, and an accessible pause button. Slow the replacement demonstration to six seconds; reduced motion still shows posters until explicit playback.

- Add three short, locally bundled onboarding demos for replacing a fictional email, revealing its original, and copying it. Each clip has playback controls and a still poster; reduced motion prevents automatic playback.

- Fade restored answer values in over 140 ms when Show originals is chosen, without moving text; reduced motion disables the fade and theme updates do not replay it.

- Make held-send choices explicit with Send as is and save-before-send Apply & send, add opt-in local replacement on paste and quick Undo, and make restored answers visibly local with Show tokens and a separate Copy with originals action. Refine token/value hierarchy, dark contrast, saved-value truncation the welcome link to the current supported chat tool, and restrained transitions that respect reduced motion.

- Choose which findings Replace or Redact affects, with exact refreshed placeholder previews. Manage each saved original with Copy, a lasting allow exception, and confirmed Forget that retires its token and hides open restored displays.

- Replace sensitive draft text directly from the circle popup after saving originals in the vault, with preview, Undo and Redo. Unchecked findings remain as typed; lasting allowances live in Rules and saved-original menus.
- Show or hide originals independently in each assistant answer while preserving the chat provider's marker text.
- Access FogVault automatically and save rules and preferences encrypted. No password or credential-migration flow is exposed; missing keys preserve existing data and report an error.
- Restyle the circle, popup, answer control, sidebar and settings with the datafog "Redacted line" tokens (Night, Deck, Fog, Mist, International Orange; Geist in extension pages) and Lucide icons. Tokens show as orange pills. Undo, Redo, Close, Show originals, Add, Remove and Look up are icon buttons with the same accessible names. The encrypted store is called the vault in the interface; explanations moved behind info buttons.
- Each setting has one home. The sidebar keeps Originals and Rules, and a gear opens the settings page, which holds sites, types, holding sends, appearance, defaults, vault deletion, About and Support. The settings page no longer repeats the allow and flag lists.
- Choose System, Light or Dark under Appearance; the choice applies to the circle, popup, answer control, sidebar and settings page.
- The circle keeps the last result in view while it re-checks, with a quiet ring instead of dots, shows a small check after a clean check, pops when the count rises, and uses shorter hover text. An open popup keeps its findings, with actions paused, until the new result lands.
- A welcome page opens once on a new install: pin datafog, reload any chat tab it could not reach, then a short "You're set". Chat tabs open at install or during an update are checked right away, without a reload, using the `scripting` permission and host access to the five chat sites.

- Ship complete Lucide ISC/Feather MIT and Geist OFL notices in the extension archive; document the nonsensitive appearance bootstrap exception.
- Rename Redact to **Mask** and Replace to **Reversible mask**, and call tokens placeholders, such as **Show placeholders**.

## [1.0.0] - 2026-11-18

The first release: a Chrome extension that checks what you type into AI chat sites for sensitive data, on your device, before you send it.

### Added

- Runs on ChatGPT, Claude, Gemini, Grok and DeepSeek. Text in the chat box is checked when you pause typing, and right away when you paste.
- Finds account numbers, API keys, bearer tokens, credential URIs, credit card numbers, email addresses, JWTs, mailing addresses, names, NPIs, private keys, SSNs, street addresses and US routing numbers by default. Phone numbers, dates, ZIP codes, IP addresses and UUIDs can be turned on in the settings. Names and mailing addresses come from a small model that runs on your device.
- A badge beside the chat box, sized and rounded to match each site's chat box and staying that size as you type or resize the window, shows pulsing dots while checking and a red count when something is found. Clicking it lists the types and counts, never the values.
- **Redact** replaces each found value with its type, such as `[EMAIL]`, with **Undo** and **Redo**. **Dismiss** hides the warning until the text changes.
- **Pseudonymize** replaces each found value with a marker, such as `[[EMAIL_7KQ4ZM]]`, after you review the values and markers in the side panel, one at a time with **Mark sensitive** or all at once with **Replace all in chat box**. Each confirms what it replaced and checks the chat again. The same value always gets the same marker.
- An encrypted vault on your device keeps the originals behind markers. It locks when Chrome closes, after 15 minutes without use, or with **Lock**. **Remember this device for 30 days** unlocks it without your password, and **Delete vault** starts over if the password is forgotten.
- **Restore latest answer** shows the original values in place of the markers in the chat's latest answer, with **Hide originals** and **Copy restored answer**.
- **Always allow** values DataFog never flags, such as your own work email, and **Always flag** phrases it always finds, such as a project or client name, from the settings or the side panel. **Not sensitive** in a review skips a value while the vault is unlocked. Adding to a list confirms it, and changing either list, the types to look for or a Not sensitive choice checks open chats again right away.
- Settings to choose what to look for, grouped by how accurately each type is found, and turn checking on or off for each site. Changes save as you make them, **Restore defaults** resets everything but your lists, and the page follows your browser's light or dark theme. Its About section shows the version, the help email and a link to the [privacy policy](https://datafog.ai/privacy-policy).
- An optional setting, off by default, holds a message with sensitive data once when you send it, with **Send anyway**.
- Warnings when a file is attached, since files aren't checked, and when the chat box can't be found, with **Update now** when a DataFog update is waiting. If a check fails, the badge shows an error code to report to help@datafog.ai.
- A DataFog side panel, opened from a tab on the page's right edge or the toolbar icon, that follows your browser's light or dark theme.

### Security

- Detection runs on your device with [DataFog Core](https://github.com/DataFog/datafog-core) 1.6. The extension makes no network requests, and errors carry codes only, never your text.
- The vault uses FogVault through Core's adapter, with an Argon2 password key. The password and originals are never stored unencrypted or shown to the chat site's scripts.
- A remembered device uses a software key that can't be exported, so anyone who can use your Chrome profile within the 30 days can unlock the vault.
- Permissions requested: `storage` for settings, `sidePanel` for the DataFog panel, and `offscreen` to keep Core running while the panel is closed.
