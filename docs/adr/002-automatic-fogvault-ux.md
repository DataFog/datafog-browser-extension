# ADR 002: Draft actions and automatic FogVault access

- **Status:** Implemented on `v1-ux-updates`; validation recorded separately
- **Date:** 2026-11-18
- **Baseline:** `3568adfa6c714a7d233efd5eeae54978b63c23e7` (`origin/main`)

## Scope

The datafog browser extension is the product; its interface calls the embedded encrypted store the vault. FogVault dependency names and persistent identifiers are preserved. The proposed multi-repository storage rename remains deferred.

This decision supersedes ADR 001's ordinary password creation/unlock, manual lock and remembered-device expiry interactions; sidebar approval before pseudonymization; unlocked-session applicability of Not sensitive; plaintext settings; floating page tab; and latest-answer restoration workflow. Site support, local processing, no extension-initiated network transmission, optional send blocking, file warnings and dependency contracts remain unchanged.

## Draft and answer ownership

The circle reports checking status on hover or keyboard focus and opens draft actions on click. Replace is primary. More exposes Redact, Always allow skipped and sidebar access. Keep as is is a decision for this draft revision only. Escape closes the current menu or popup and returns focus; outside interaction dismisses the popup.

Replace prepares and durably commits encrypted original mappings before applying placeholders. The displayed concrete marker comes from the exact retained Core preparation, identified by a preview token. Core supports one live preparation per workspace: another tab or a policy change can expire that token. Replace then preserves the draft, refreshes the preview and requires an intentional retry; it never silently inserts a different code. A changed draft invalidates pending editor application, even if the mapping save succeeded. The popup distinguishes saving, saved, superseded and failed application. Redact does not persist reversible mappings. Undo/Redo belongs only to the unchanged transformed draft and expires on unrelated editing. These actions never send a chat.

Each finding starts chosen. Unchecking a finding keeps its value as typed and prepares a fresh exact preview for the remaining choices. Replace commits only that accepted preview; Redact leaves skipped values alone. Neither action is available with nothing chosen. Selection refresh has the same tab, draft and committed-policy freshness boundaries as scanning. Same-draft rescans retain choices; edits reset them. Always allow skipped applies only to skipped values, replacing the previous blanket popup action.

Each assistant answer has independent content freshness, read progress and original visibility. A single control in its action row toggles all known occurrences. Unknown markers remain visible. Answers with no restorable markers have no restoration action. Original values are rendered in extension-owned local display; provider message text remains markers. Streaming, redraw and removal invalidate stale reads and displays.

## Automatic encrypted storage

The existing FogVault workspace and device-slot APIs remain in use. A non-extractable local WebCrypto key is held in the existing `datafog-device` IndexedDB database. Settings are persisted as an authenticated AES-GCM envelope in that database, using the local device key. FogVault's existing encrypted database retains mappings and typed value choices. Only nonsensitive bootstrap routing and lifecycle metadata live outside encrypted payloads.

Normal startup creates a key only for a new empty store. A missing key or corrupt store is an access failure, never permission to reset data or persist plaintext. Password-only stores are not supported: no such stores have been released, and the extension has no password entry or credential-migration path. Automatic local-key access remains the supported path. An inaccessible store is preserved and reported as unavailable; it is never silently replaced.

Migration verifies the encrypted replacement before deleting old plaintext settings. A committed policy version controls scan freshness; saved preferences and rules propagate to unchanged open drafts only after durable commit. Settings failures show checking unavailable rather than substitute defaults.

Chrome profile access remains the trust boundary. This is persistent encrypted storage, not zero data retention. No new retention expiry or full-chat storage policy is introduced.

### Appearance bootstrap exception

The appearance choice is a deliberate, narrow exception to encrypted preferences. Only the `theme` enum (`system`, `light` or `dark`) is stored unencrypted in `chrome.storage.local`. It contains no prompt text, original values, allow/flag entries, detection choices, site preferences or key material. Surfaces need it before vault access is ready so the circle, popup, sidebar, settings and answer controls can use a consistent theme, including while storage is unavailable.

Detection settings, rules, typed exceptions and original mappings remain encrypted. Theme changes do not change the checking policy. Deleting vault data retains this appearance choice and unrelated onboarding metadata; it still removes the vault's original mappings, rules, encrypted checking preferences and local key. This exception does not authorize storing other preferences or sensitive values in plaintext.

## Rules and compatibility

Existing typed Not sensitive choices retain their type-aware normalization and become lasting Always allow exceptions. Existing literal allowlist semantics remain distinct and preserved; Always flag retains its existing whole-word, case-insensitive precedence. New popup exceptions use the typed choice path rather than silently broadening existing values to arbitrary substring rules.

The supported Core API does not enumerate historical mappings. A new encrypted marker index enables the sidebar to list mappings recorded by this version. Historical mappings remain restorable when their markers appear in an answer, but unseen historical mappings cannot all be listed in the sidebar.

## Saved-original actions

Each saved row offers Copy original, Always allow this value and confirmed Forget. Allow remains a typed lasting exception and is visibly marked once committed. Forget uses Core's supported `prepareForget` operation to retire the token, with the existing durable save/reconciliation boundary. It removes that saved original and invalidates open answer displays; provider message text remains unchanged markers. Cancellation and confirmed failure preserve the mapping, and uncertain outcomes are reconciled before success is reported. Original/token pairs cannot be edited. Cryptography, database formats and detection policy are unchanged.

## Deletion

Deletion requires typed confirmation in settings. Cancellation preserves storage. The scope is datafog's FogVault mappings and choices, encrypted settings and local key/bootstrap metadata; it excludes chat-provider messages and unrelated browser data. A durable deletion marker makes partial cleanup retryable and prevents an incomplete deletion being treated as a successful empty-store initialization. Failure must remain visible until reconciliation or retry completes.

## Validation

The implementation keeps the fourteen behavior owners described in the UX package separate: circle surface, sidebar view, scan, draft operation/history, send gate, per-answer display/read, storage access, commit/recovery, committed policy deletion lifecycle, welcome progression, content-copy lifecycle, draft selection and saved-original row actions. Behavioral unit tests cover failure and freshness boundaries; Chrome integration tests cover the five supported site profiles using controlled DOM fixtures. Fixture coverage is not evidence that current authenticated production site markup was smoke-tested. See the implementation handoff for actual command results and remaining validation gaps.
