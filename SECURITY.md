# Security policy

The DataFog browser extension checks prompts for personal data and credentials before they are sent to an AI chat site, so a flaw in what it reveals, stores, or can access is a security issue.

## Reporting a vulnerability

Email help@datafog.ai with the details.

## In scope

- Prompt text, matched values, or allowlist or Always flag values leaving the device, including in any network request.
- Those values appearing in a console log, an error message, or anywhere a page script can read them beyond what the user typed.
- Settings, allowlist or Always flag values stored outside `chrome.storage.local`, or readable by a website.
- The extension running on, or requesting access to, sites and permissions beyond those in its manifest.
- Redact or Pseudonymize leaving a detected value in the chat box.
- The vault password or original values behind markers reaching a web page, a log, or storage outside the encrypted vault.

## Out of scope

- Values the detectors miss, or match wrongly. Detection is pattern-based and not exhaustive; report these to help@datafog.ai as well.
- Text the user sends after dismissing a warning, or that the chat site itself collects.

## Supported versions

Security fixes go into the latest release.
