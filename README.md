# datafog browser extension

datafog checks what you type into ChatGPT, Claude, Gemini, Grok and DeepSeek for sensitive data, such as email addresses, card numbers, API keys, names and mailing addresses, before you send it. Checks run on your device with [DataFog Core](https://github.com/DataFog/datafog-core); nothing you type is sent anywhere. A badge beside the chat box shows what was found, and lets you replace or redact it.

## Features

- **Checks as you type**, and right away when you paste. Hover or focus the circle for checking status; click to preview findings and placeholders.
- **Choose findings** in the popup: uncheck values to keep them as typed. Replace and Redact affect the chosen findings; Always allow applies only to skipped values.
- **Replace** saves originals to your encrypted vault before inserting markers such as `[[EMAIL_7KQ4ZM]]`. Progress, errors, Undo and Redo stay in the draft popup.
- **More → Redact** replaces values with labels such as `[EMAIL]` without saving reversible mappings. Local Undo remains available until you edit the draft.
- **Keep as is** leaves only this draft revision unchanged. **Always allow skipped** saves lasting exceptions for skipped values, and **Always flag** takes precedence.
- **Show originals / Hide originals** toggles known markers for one assistant answer. Original values appear in extension-owned local display; the provider's underlying text remains markers.
- **Manage saved originals** from each row’s menu: copy the original, always allow its typed value, or confirm Forget to retire its token. Forgotten tokens remain in chats but no longer restore.
- **The vault** uses FogVault to store original mappings, rules and checking preferences encrypted on this device with automatic local-key access. There is no password entry or recovery password; losing the local key makes saved originals unrecoverable.
- **Choose what to check for**, grouped by how accurately each type is found, and which sites to check in the settings. Changes save as you make them.
- **Hold sends** (optional, off by default): pauses a message with sensitive data once, with **Send anyway**.
- **Warns you** when a file is attached, since files aren't checked, and when a chat box can't be found, so the page isn't protected.

## Install

### From the Chrome Web Store

Install datafog from its [Chrome Web Store listing](https://chromewebstore.google.com/) (link coming soon), then open a supported chat site.

### From source

You need Node.js 24 and Google Chrome.

```bash
git clone https://github.com/DataFog/datafog-browser-extension.git
cd datafog-browser-extension
npm ci
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select the `dist/` folder.
3. Open a supported chat site and type, for example: `my email is jane@example.com and card 4111 1111 1111 1111`.

Choose **More → Open sidebar** in the draft popup, or click the extension toolbar icon, to manage saved originals and rules. The sidebar gear opens settings for checking preferences, appearance and vault deletion.

## Uninstall

Open `chrome://extensions` and click **Remove** on datafog, or right-click the toolbar icon and choose **Remove from Chrome**. This works the same for a build loaded from source; afterward you can delete the cloned folder.

Removing datafog deletes its vault, settings and lists from Chrome. Values behind markers in past chats can't be restored after that.

## Limitations

- Runs only on ChatGPT, Claude, Gemini, Grok and DeepSeek, in Google Chrome on desktop.
- Checks text in the chat box only, not attached files.
- Detection isn't exhaustive. Names and mailing addresses come from a small model that misses some in everyday chat text; other types are pattern-based.
- Redaction is one way: `[EMAIL]` can't be turned back into the original.
- Unknown or deleted markers cannot be restored.
- Access to the Chrome profile is the trust boundary: automatic local key access is not an additional password barrier. Missing keys or damaged storage produce an error; the extension does not silently reset existing data.
- Chat sites change their pages without notice, which can stop datafog from finding the chat box until it's updated.

## Privacy

datafog checks text on your device and sends nothing anywhere. See the [privacy policy](https://datafog.ai/privacy-policy).

## Security

Report vulnerabilities to help@datafog.ai. See [SECURITY.md](SECURITY.md) for details.

## License

[MIT](LICENSE). Built by [datafog](https://datafog.ai).
