# Chrome Web Store permission justification

Draft listing copy for the current extension; this document does not submit or publish a store listing.

## Host access

> datafog checks text you type into AI chat composers for sensitive information before you send it. It runs only on chatgpt.com, claude.ai, gemini.google.com, grok.com and chat.deepseek.com. Access to these pages lets it add its checking circle, replace or redact selected draft values when you choose, and show saved originals locally in assistant answers. It does not request access to other websites.

Declared patterns:

- `https://chatgpt.com/*`
- `https://claude.ai/*`
- `https://gemini.google.com/*`
- `https://grok.com/*`
- `https://chat.deepseek.com/*`

## Scripting

> The scripting permission lets datafog activate its bundled content script in supported chat tabs that were already open when the extension was installed or updated. This keeps checking available without requiring those tabs to reload. Injection is limited to the five declared chat sites; the extension does not download or execute remote code.

## Local processing

> The extension checks prompt text on your device. It does not transmit your typed text, saved originals, rules or keys to datafog or another service. Original mappings and checking preferences are stored encrypted in your local browser profile. You remain in control of sending messages through the chat site's own controls; the extension does not send chats automatically.

This describes the extension's behavior, separately from the chat provider's handling of messages that the user chooses to send.
