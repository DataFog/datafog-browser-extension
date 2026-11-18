# Security policy

The datafog browser extension checks prompts for personal data and credentials before they are sent to an AI chat site, so a flaw in what it reveals, stores, or can access is a security issue.

## Reporting a vulnerability

Email help@datafog.ai with the details.

## In scope

- Prompt text, matched values, or allowlist or Always flag values leaving the device, including in any network request.
- Those values appearing in a console log, an error message, or anywhere a page script can read them beyond what the user typed.
- Sensitive preferences, allowlist or Always flag values persisted unencrypted, or readable by a website. The nonsensitive appearance enum is the documented [bootstrap exception](docs/adr/002-automatic-fogvault-ux.md#appearance-bootstrap-exception).
- The extension running on, or requesting access to, sites and permissions beyond those in its manifest.
- Redact or Replace leaving a detected value in the chat box.
- Vault key material or original values behind markers reaching a web page, a log, or storage outside the encrypted vault.

## Out of scope

- Values the detectors miss, or match wrongly. Detection is not exhaustive; report these to help@datafog.ai as well.
- Text the user sends after dismissing a warning, or that the chat site itself collects.

## Known limitations

Chrome profile access is the trust boundary. An AI agent or other browser-use tool acts with the user's own access: it can open the sidebar and view saved originals through automatic local-key access. datafog cannot distinguish that agent from the user. There is no manual vault lock or recovery password.

The non-extractable key is local to the browser profile. Losing that key makes saved originals unrecoverable through the extension; an inaccessible store is preserved and reported unavailable, never silently reset.

## Supported versions

Security fixes go into the latest release.
