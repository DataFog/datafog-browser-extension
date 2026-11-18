# Explicit state machines for the browser extension UX

Status: historical design proposal, followed by revision additions. This describes the datafog browser extension UX. The implementation calls its embedded encrypted store the vault and retains FogVault dependency and storage identifiers; the proposed storage rename was deferred.

This document records the supplied design proposal and its later welcome/content-copy additions. References below to existing behavior or unresolved decisions describe the proposal’s original context, not the final implementation. The first ten groups are the original recommended explicit models; sections 11 and 12 extend them. See [ADR 002](../adr/002-automatic-fogvault-ux.md) for implemented decisions, including automatic encrypted access, matching semantics and the appearance bootstrap exception.

## Modeling rules

- Own draft state by tab/composer and draft revision; own answer state by answer ID and content version. Include the committed policy version when accepting scan results.
- Keep independent axes independent. Popup visibility is not scan status; answer visibility is not read progress; Undo/Redo history is not storage access.
- Send events between owners with operation IDs and captured revisions. Ignore results whose owner, revision, or policy is no longer current.
- Derive progress, success, error, and action availability from these models. Brief confirmations and layout calculations do not each need their own application state machine.

## 1. Circle interaction

**Owner:** the circle/popup for the current composer.

**States:** circle only; status tooltip visible; action popup open; More menu open. The More menu can be a child of the popup rather than another independent surface.

**Events:** hover/focus shows status; leave/blur dismisses transient status; click opens draft actions; More opens the menu; close/Escape returns to the circle. The exact outside-click and focus-return behavior needs to be specified during implementation.

Scan findings, operation progress, and history availability determine the content and buttons, independently of surface visibility. Replace stays in this popup and shows progress, confirmation, errors, and relevant Undo/Redo controls.

## 2. Sidebar

**Owner:** one sidebar instance per browser window.

**Independent axes:** closed/open; active view for saved originals, rules, or preferences. The exact navigation layout remains a design choice.

**Events:** open from the popup or extension toolbar; navigate; close. Opening the sidebar neither reveals originals in a chat nor asks the user to unlock storage. Storage readiness and list-loading errors are supplied by the owning data workflows.

The floating page tab is removed in the proposed UX. Browser connection/reconnection remains an implementation lifecycle, separate from the user's open/closed state.

## 3. Draft scanning

**Owner:** current composer and draft revision.

**States:** checking disabled; idle/empty; dirty/debouncing; checking; checked with no findings; checked with findings; checking unavailable.

**Events:** edit/paste; debounce elapsed; checking enabled/disabled; committed policy changed; scan succeeded/failed; retry. Edits and policy changes invalidate earlier results. Only a result for the current revision and policy may determine the badge or release a held send.

The circle's status is a projection of this model. Hovering or opening the popup must not freeze scan freshness.

## 4. Draft actions and history

**Owner:** current draft revision, with a captured revision for each operation.

**Independent axes:**

- Decision: unresolved or kept as typed for this revision.
- Transformation: idle; replacement/redaction requested; waiting for required storage; saving originals for Replace; applying edits; completed; failed or superseded.
- History: none; applied with Undo available; undone with Redo available; invalidated by an unrelated edit.

**Events:** Replace; Redact; Keep as is; save result; application result; Undo/Redo; edit. Replace waits for a confirmed encrypted save before applying placeholders. Redact does not persist a reversible mapping. Keep as is preserves the current draft and expires when it is edited. Always allow belongs to the persistent rule workflow below.

Never apply an old operation to a newer draft. A save can succeed even if editor application subsequently becomes invalid; preserve that distinction in the result. The proposed flow removes the separate sidebar review/approval step, while retaining preparation, persistence, and application internally.

## 5. Send blocking

**Owner:** current composer, draft revision, and effective send-blocking preference.

**States:** allowed; awaiting a current check; held for review or checking failure; explicitly overridden. A short programmatic-send phase can prevent the extension from blocking its own release action.

**Events:** send attempt; scan result; explicit Send anyway; draft edit; committed preference change. Findings and checking failures carry different hold reasons. Editing invalidates a queued send and any override tied to the previous revision.

This remains optional behavior. No transformation, reveal, or storage operation sends a chat automatically. Timeout and repeated-key handling need explicit implementation rules rather than being inferred from popup visibility.

## 6. Original visibility per answer

**Owner:** one instance per assistant answer and content version.

**Independent axes:** markers/originals visible; read idle/pending/failed; restoration result complete/partial/none. A read failure leaves markers visible. Partial restoration reveals known originals and leaves unknown markers unchanged, with a notice.

**Events:** Show originals; read result; Hide originals; answer content changed or removed. One control in the answer's action row covers all known occurrences in that answer. Showing one answer does not hide another. No restorable markers means no Show originals control.

Reveals change local display only. The provider's stored answer remains placeholders. Hide clears the local reveal without requiring a storage write. Ignore reads for an outdated answer version.

## 7. Automatic encrypted-storage access

**Owner:** the browser profile's Foglet storage service.

**States:** stopped; initializing; ready; unavailable; retrying initialization. There is no user-facing locked/unlocked session.

**Events:** runtime start; local key/store loaded; new empty store initialized; access failed; retry; runtime end. Create a key only for a new empty store. Existing ciphertext with a missing key is an access error, not permission to replace the key or erase data.

Persist originals, rules, preferences, and retained exceptions as ciphertext. Never fall back to plaintext persistence. Release owned transient plaintext when its runtime session ends; retain ciphertext and the local key. Chrome profile access remains the trust boundary. Key storage and migration details still need an implementation decision.

## 8. Commit and recovery

**Owner:** each durable storage operation, coordinated by the Foglet service.

**States:** prepared; saving; confirmed; confirmed failure; outcome uncertain; reconciling. Operation identity and commit certainty are separate from the requesting UI's visibility.

**Events:** commit; confirmed acknowledgement; known rejection; lost/uncertain outcome; reconciliation result. Reconcile an uncertain operation before treating a retry as a new write. Do not report replacement or settings success until the relevant durable commit is confirmed.

This remains necessary without passwords or manual locks. Recovery must preserve existing data and report its actual outcome to the original workflow.

## 9. Rules and preferences

**Owner:** profile-wide committed configuration, with local edit buffers for each surface.

**Independent axes:** local editing/debounce state; save queued/pending/failed; committed configuration version; propagation/rescan pending or applied.

**Events:** edit; Always allow/Always flag; remove rule; save; commit result; policy broadcast; rescan result. Commit encrypted changes before making them effective, then recheck open drafts. Drafts must not accept results from the previous policy version.

Always allow is lasting and independent of an unlock session; Always flag has precedence. The old Not sensitive choice is consolidated into this lasting exception in the proposal. Exact matching, scope, and migration rules remain unresolved. A load failure shows checking as unavailable rather than silently substituting a different policy.

## 10. Foglet deletion

**Owner:** profile-wide storage lifecycle, with confirmation UI in the sidebar.

**States:** awaiting confirmation; deleting; confirmed deleted; failed with the actual remaining storage state known or requiring recovery.

**Events:** request deletion; confirm/cancel; deletion result; retry or recovery. Cancelling preserves data. Successful deletion invalidates dependent views and transient plaintext held by the extension. A failure must not be presented as successful deletion merely because the form closed.

The exact deletion scope, confirmation wording, and partial-failure recovery policy require a separate decision. This recommendation does not introduce an unlock requirement.

## 11. First run

**Owner:** the service worker's install handler and the welcome page, opened once per install.

**States:** not started; pin; reload (only when a chat tab open at install could not be reached); done. Every step can be skipped. `onboarded` in local storage records that the flow was closed from its last screen.

**Events:** `runtime.onInstalled` with reason `install` opens the welcome page; `update` and reloads never do. While the pin step shows, the page polls `action.getUserSettings().isOnToolbar` about once a second, because Chrome sends no event when the user pins. Pinning never blocks Next. Vault status is read once on open; the last screen reports ready or still setting up and never asks for a password.

## 12. Content-script copies per page

**Owner:** each chat page.

**States:** claiming; live; retired.

**Events:** the service worker injects the content script into open chat tabs at install and after every update (`scripting` + host permissions for the five sites). A starting copy asks over a DOM event whether another copy is present. A live copy answers and the newcomer stops; an orphaned copy (its extension context is gone after an update) retires instead. A retired copy removes its circle and answer controls, stops observing, and never holds a send. Tabs the service worker cannot reach are listed for a reload on the welcome page. A copy that starts while the vault is still opening retries its first settings read with backoff before reporting checking as unavailable.

## What disappears or gets simpler

| Existing behavior                                                       | Proposed change                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Password creation/unlock forms                                          | Removed from the ordinary workflow.                                                                                             |
| Manual lock, remembered-device enrollment/pause, and lock-expiry timing | Removed as user-facing access workflows; automatic key access and runtime cleanup remain.                                       |
| Queued review waiting for unlock and separate sidebar approval          | Replaced by preparation/save/apply progress in the draft popup.                                                                 |
| Not-sensitive applicability changing with lock state                    | Becomes a committed lasting rule rather than an unlocked-session exception.                                                     |
| Restore latest-answer targeting and sidebar copied-answer cache         | Replaced by explicitly targeting each answer's reveal workflow; no separate copied-answer cache is required by the proposed UX. |
| Sidebar access-dependent form switching                                 | Simplifies to data views with automatic storage readiness/error handling.                                                       |

Scan freshness, valid Undo/Redo, send blocking, commit recovery, local original visibility, settings propagation, and deletion remain. Composer discovery, runtime connections, model scheduling, badge placement, and brief feedback also remain as implementation behavior; they do not all require separate product-level statecharts.
