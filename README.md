# DataFog browser extension

DataFog checks what you type into ChatGPT, Claude, Gemini, Grok and DeepSeek for sensitive data, such as email addresses, card numbers, API keys, names and mailing addresses, before you send it. Checks run on your device with [DataFog Core](https://github.com/DataFog/datafog-core); nothing you type is sent anywhere. A badge beside the chat box shows what was found, and lets you redact or pseudonymize it.

## Features

- **Checks as you type**, and right away when you paste. The badge shows how many values were found, by type, never the values themselves.
- **Redact** replaces each value with its type, such as `[EMAIL]`, with **Undo** and **Redo**.
- **Pseudonymize** replaces each value with a marker, such as `[[EMAIL_7KQ4ZM]]`, after you review them in the side panel. The originals are kept in an encrypted vault on your device.
- **Restore** shows the original values in place of the markers in the chat's latest answer.
- **Always allow** values DataFog should never flag, such as your own work email, and **Always flag** phrases it should always find, such as a project or client name. Mark a value **Not sensitive** in a review to skip it while the vault is unlocked.
- **Choose what to check for** and which sites to check in the settings.
- **Hold sends** (optional, off by default): pauses a message with sensitive data once, with **Send anyway**.
- **Warns you** when a file is attached, since files aren't checked, and when a chat box can't be found, so the page isn't protected.

## Install

### From the Chrome Web Store

Install DataFog from its [Chrome Web Store listing](https://chromewebstore.google.com/) (link coming soon), then open a supported chat site.

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

Click the DataFog tab on the right edge of the page, or the toolbar icon, to open the side panel. Its **Settings** button opens the settings.

## Uninstall

Open `chrome://extensions` and click **Remove** on DataFog, or right-click the toolbar icon and choose **Remove from Chrome**. This works the same for a build loaded from source; afterward you can delete the cloned folder.

Removing DataFog deletes its vault, settings and lists from Chrome. Values behind markers in past chats can't be restored after that.

## Limitations

- Runs only on ChatGPT, Claude, Gemini, Grok and DeepSeek, in Google Chrome on desktop.
- Checks text in the chat box only, not attached files.
- Detection isn't exhaustive. Names and mailing addresses come from a small model that misses some in everyday chat text; other types are pattern-based.
- Redaction is one way: `[EMAIL]` can't be turned back into the original.
- Restore covers only the latest answer.
- The Always allow and Always flag lists are saved unencrypted in Chrome's storage for DataFog, on your device.
- Chat sites change their pages without notice, which can stop DataFog from finding the chat box until it's updated.

## Security

Report vulnerabilities to help@datafog.ai. See [SECURITY.md](SECURITY.md) for details.

## License

[MIT](LICENSE). Built by [DataFog](https://datafog.ai).
