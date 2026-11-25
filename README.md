# datafog browser extension

datafog checks what you type into ChatGPT, Claude, Gemini, Grok and DeepSeek for sensitive data, such as email addresses, card numbers, API keys, names and mailing addresses, before you send it. Checks run on your device with [DataFog Core](https://github.com/DataFog/datafog-core); checking never uploads your draft. A badge beside the chat box shows what was found, and lets you replace or redact it.

## Features

- **Checks as you type**, and right away when you paste. Hover or focus the circle for checking status; click to preview findings and placeholders.
- **Choose each finding** in the popup: select **Replace** or **Redact** on each row, or uncheck it to keep that occurrence as typed. **Apply** commits the whole preview in one operation with one Undo.
- **Replace** saves that row’s original to your encrypted vault before inserting a marker such as `[[EMAIL_7KQ4ZM]]`. Progress, errors, Undo and Redo stay in the draft popup.
- **Redact** inserts a label such as `[EMAIL]` without saving that original or a reversible mapping. Mixed batches save only Replace rows. Local Undo remains available until you edit the draft.
- **Close** dismisses the popup without changing the draft or suppressing findings. Lasting allow exceptions live in Rules and saved-original menus; **Always flag** takes precedence.
- **Show originals / Show tokens** toggles known markers for one assistant answer. Original values appear in extension-owned local display; the provider's underlying text remains markers. Local originals have a token tooltip, and **Copy with originals** is separate from the site's ordinary Copy action.
- **Manage saved originals** from each row’s menu: copy the original, always allow its typed value, or confirm Forget to retire its token. Forgotten tokens remain in chats but no longer restore.
- **The vault** uses FogVault to store original mappings, rules and checking preferences encrypted on this device with automatic local-key access. There is no password entry or recovery password; losing the local key makes saved originals unrecoverable.
- **Choose what to check for**, grouped by how accurately each type is found, and which sites to check in the settings. Changes save as you make them.
- **Hold sends** (optional, off by default): **Apply & send** saves the required originals and applies the current mixed preview before sending once. Unchecking every row offers **Send as is** as an explicit choice. Proactive Apply never sends.
- **Automatically replace on paste** (optional, off by default) saves originals and replaces the pasted draft locally, with a quick **Undo**. Pasting never sends a message.
- **Warns you** when a file is attached directly to the provider, and when a chat box can't be found, so the page isn't protected.

## Scan a PDF

Open the target conversation and click the datafog toolbar icon. In **Files**, drop a PDF or choose a file. Review the extracted text and any page warnings. Switch between **Original** and **As sent** to see exactly what will enter the draft. Open the larger viewer for a side-by-side list of findings.

Choose **Reversible mask** to save the original in the vault, **Mask** for a permanent label, or uncheck an occurrence to keep its text. **Insert** appends the reviewed document to the existing draft. **Undo** removes the insertion while the draft is unchanged. Sending remains a separate action in the chat.

Rampart checks names and addresses by default in drafts and PDFs. Settings also offers the DataFog CNN. The extension installs OCRia’s Latin OCR model with LiteParse, so scanned PDFs work offline from the first use.

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

Click the extension toolbar icon to manage saved originals and rules. The sidebar gear opens settings for checking preferences, appearance and vault deletion.

## Uninstall

Open `chrome://extensions` and click **Remove** on datafog, or right-click the toolbar icon and choose **Remove from Chrome**. This works the same for a build loaded from source; afterward you can delete the cloned folder.

Removing datafog deletes its vault, settings and lists from Chrome. Values behind markers in past chats can't be restored after that.

## Limitations

- Runs only on ChatGPT, Claude, Gemini, Grok and DeepSeek, in Google Chrome on desktop.
- The provider’s own upload button attaches the original file. Use **Scan PDF** in the datafog side panel to insert reviewed text. The extension does not produce a redacted PDF.
- Both name and address models can miss identifying text or flag ordinary words. Review the full extracted text, especially spelling, addresses split across lines, and page order.
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
