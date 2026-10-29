# Security policy

The DataFog browser extension checks prompts for personal data and credentials before they are sent to an AI chat site, so a flaw in what it reveals, stores, or can access is a security issue.

## Reporting a vulnerability

Report it privately through GitHub using [Report a vulnerability](https://github.com/DataFog/datafog-browser-extension/security/advisories/new). If that isn't available to you, email hi@datafog.ai.

Please don't open a public issue or pull request for a vulnerability, and don't include real personal data in a report. A synthetic example is enough.

## In scope

- Prompt text, matched values, or allowlist values leaving the device, including in any network request.
- Those values appearing in a console log, an error message, or anywhere a page script can read them beyond what the user typed.
- Settings or allowlist values stored outside `chrome.storage.local`, or readable by a website.
- The extension running on, or requesting access to, sites and permissions beyond those in its manifest.
- Redact leaving a detected value in the chat box.

## Out of scope

- Values the detectors miss, or match wrongly. Detection is pattern-based and not exhaustive; report these as regular issues.
- Text the user sends after dismissing a warning, or that the chat site itself collects.

## Supported versions

Security fixes go into the latest release.
