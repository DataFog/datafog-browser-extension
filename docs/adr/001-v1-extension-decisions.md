# ADR 001: V1 Extension Decisions

- **Status:** Proposed
- **Date:** 2026-11-01

## Context

Core 1.0.0 and FogVault 0.1.0 are published
([#9](https://github.com/DataFog/datafog-browser-extension/issues/9)). Core
handles workspace behavior, FogVault handles encryption and storage, and Core's
browser adapter connects them. The extension owns the UI, permissions,
credentials and the interaction with the chat site.

Core's [ADR 004](https://github.com/DataFog/datafog-core/blob/main/docs/adr/004-workspace-aliasing-v1.md)
sets the V1 workspace decisions. This ADR records the extension's own V1
decisions on top of it, including one change to ADR 004's scope.

## Decision

### Vault

The extension uses FogVault through Core's adapter, pinned exactly:

- `@datafog/wasm` 1.1.0
- `@datafog/fogvault-browser` 0.1.0
- `@datafog/core-fogvault-browser` 1.1.0

Core 1.1.0 adds `prepareForget` for mapping TTL. It was first pinned as
1.1.0-rc.1, which has the same runtime.

Core, the FogVault Worker and the model run in an offscreen document, not the
service worker, which Chrome stops when idle and which can't start Workers. The
offscreen document stays loaded while the side panel is closed, so checking and
pseudonymization keep working. The side panel is the UI for the vault and
workspace; it stays open beside the chat, unlike a full tab.

If the device isn't remembered, the vault locks when Chrome closes or after 15
minutes without use. The adapter allows one prepared change at a time, so the UI discards
reviews that are no longer needed. Locking goes through the adapter, and the
extension also clears any plaintext previews and restored text it holds.

The prototype never stored mappings, so there is no legacy backup format to
import.

### Remember device

V1 includes an opt-in "Remember this device for 30 days" at unlock. ADR 004
lists remembered unlock as out of V1; this ADR moves it into V1, built in the
extension rather than in FogVault.

- FogVault unlocks with a password, so the extension stores the password
  wrapped with a non-extractable WebCrypto key in IndexedDB. It is never put in
  `chrome.storage.sync`.
- The 30 days run from unlock and are not extended by use. Until then, the
  vault unlocks on its own, including after Chrome restarts.
- "Forget this device" removes the stored credential. Locking still clears
  everything in memory.
- Anyone who can use the Chrome profile can open the vault while the device is
  remembered. The vault encryption review covers this.

### Mapping TTL

Mappings expire 30 days after they were last touched. A mapping is touched when
it's created and each time it's restored; each touch resets the clock. Values
that keep coming back in answers stay in the workspace; values that don't drop
out, so the workspace doesn't grow into a full list of a person's PII. It also
keeps saves small, since the adapter saves the whole workspace each time.

TTL is applied by the extension. Core 1.0 has no API to remove or expire a
mapping, so this depends on a Core addition, proposed separately.

- Finding a value in a new prompt doesn't reset its clock. A value that's
  pseudonymized often but never restored expires 30 days after it was created.
- A value seen again after it expires gets a new marker.
- Markers in older conversations whose mapping expired can't be restored. The
  restore view says so rather than showing them as damaged.

### Model

V1 finds names and addresses with the statements CNN bundled in Core 1.1.0
(about 1 MB of weights, compiled into Core's WebAssembly), in its own Worker in
the offscreen document. It replaces the earlier plan to ship GLiNER2.5 Small
(about 297 MB): it's bundled, needs no download, and is fast enough to run on
every check. It's tuned for statements, so it misses more in everyday chat text.
Other types keep using Core's rules, and the model's Worker closes while Name
and Mailing address are both off.

### Send blocking

V1 adds an optional setting, off by default, that blocks a send once to warn
the user. It applies when the chat box has a value the user could redact or
pseudonymize and they haven't chosen an action for it: Redact, Pseudonymize,
Dismiss or Send anyway.

- "Send anyway" is always available, so the block never traps a message.
- For a warning, pressing send a second time without choosing an action counts
  as Send anyway.
- It fails closed: if DataFog errors, the send is blocked and the user is told
  DataFog failed. It stays blocked until the user clicks Send anyway; pressing
  send again doesn't get through.
- It covers the send button, Enter, and input methods that compose text.
- It shares one send observer with conversation tracking, which already needs
  to record actual sends.

### Out of V1

- file upload scanning and CSV
- sites other than ChatGPT
- the other ADR 004 exclusions, except remembered unlock (above)

## Consequences

- ADR 004 needs an amendment for remembered unlock.
- TTL waits on the Core API; the rest of V1 does not.
- The offscreen document holds Core, FogVault and the model's Worker, with a
  second copy of Core, in memory while Chrome is open.
- The README and CHANGELOG no longer promise that the extension never touches
  ChatGPT's send button. Users who leave send blocking off keep that behavior.
- The V1 acceptance run in #9 covers the vault, restore and conversation flow;
  remember device, TTL and send blocking need their own end-to-end cases.
