# V1 UX implementation handoff

## Review state

- Local branch: `v1-ux-updates`.
- Baseline: latest `origin/main` at `3568adfa6c714a7d233efd5eeae54978b63c23e7`.
- Implementation and validation completed before committing; the owner subsequently authorized a PR, with no merge. Unrelated `.devcontainer/` and original local work were preserved; the supplied revision patch intentionally updates `docs/ux/explicit-state-machines.md`.
- The interface calls the store vault; FogVault published package names and persistent identifiers were retained. The proposed storage rename was explicitly deferred.

## Implemented behavior

The circle previews the current draft's findings and markers. The displayed concrete marker comes from the exact retained Core preparation, identified by a preview token. Core supports one live preparation per workspace: another tab or a policy change can expire that token. Replace then preserves the draft, refreshes the preview and requires an intentional retry; it never silently inserts a different code. Replace commits encrypted originals before applying placeholders; progress, failures and valid Undo/Redo stay in the popup. Keep as is belongs to the unchanged draft. More contains Redact, lasting Always allow and sidebar access. The floating page tab is removed.

Answers independently toggle known originals in extension-owned display, including repeated and adjacent markers. Provider text stays unchanged. Unknown markers remain markers and receive a partial-result notice when mixed with known markers. The sidebar has exactly two tabs, Originals and Rules. Its gear opens settings, which owns checking preferences, appearance and vault deletion.

FogVault opens automatically with a local non-extractable key. Original mappings, typed exceptions, literal allow/flag rules and checking preferences are encrypted. Only the nonsensitive appearance enum is an explicit plaintext bootstrap exception. Password-only stores are not supported; vault access uses the local device key automatically. Missing keys and storage corruption preserve existing data and show unavailable checking. Deletion requires confirmation and retains recovery state for partial failures.

See [ADR 002](adr/002-automatic-fogvault-ux.md) for superseded decisions, matching semantics, key boundaries, deletion scope and retained requirements.

## State ownership

| Behavior                         | Owner                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Circle, popup, More              | `CircleSurface` derives visibility from the owning DOM; `BadgeState` projects checking status |
| Sidebar                          | `activeView` and access union in `panel.ts`                                                   |
| Draft scanning                   | `ScanState`, sequence, draft revision and policy token in `content.ts`                        |
| Draft transformation and history | `ActionState`, operation ID, revision and `Redaction` history in `content.ts`                 |
| Send blocking                    | `SendState` plus IME/repeated-key guards                                                      |
| Per-answer original display      | `AnswerState`, content version and scoped overlay in `originals.ts`                           |
| Automatic storage access         | `AccessState` in `offscreen.ts`                                                               |
| Commit/reconciliation            | `CommitState` in `vault.ts`                                                                   |
| Rules/preferences                | `PolicyState`, verified ciphertext writes and committed policy token                          |
| Deletion/recovery                | `DeletionState` in `vault.ts`, durable deletion metadata and settings confirmation state      |

## Revision validation evidence

The exact binary patch in `datafog-ux-revision.zip` passed `git apply --check --binary` before application. No hand merge was needed. Dependencies were installed with `npm ci` on Node `24.18.0`; audit reported zero vulnerabilities.

The first revision run passed 299 unit tests but failed four existing circle-geometry browser assertions because count animation scaled the hit target. The implementation now animates only the count; the original tests were unchanged and all 67 browser tests passed. Exact failures are retained in `.playwright/exports/ux-revision-initial-integration-output.log`.

Followups were implemented and validated as separate logical groups:

- **a:** Removed credential-migration UI/backend/tests, preserving automatic access and storage formats. Format, lint, typecheck, build, 293 unit tests and 67 browser tests passed. The six fewer unit tests are the removed credential-migration cases. Log: `.playwright/exports/ux-revision-group-a-validation.log`.
- **b:** Lowercased product-facing copy while preserving legal names, package names and identifiers. The same full gate passed, 293/67. Log: `.playwright/exports/ux-revision-group-b-validation.log`.
- **c:** Documented the narrow plaintext appearance exception in ADR 002; documentation formatting passed.
- **d:** Shipped complete Lucide ISC/Feather MIT and Geist OFL notices. `npm run package` passed; archive notice bytes match source and the complete upstream Lucide license. Existing FogVault notices remain bundled. Permission justification is a [draft only](chrome-web-store-permissions.md).

The revision notice-shipping gate passed formatting, lint, typecheck, build, **293 unit tests across 18 files and 67 Chrome integration tests** (2.2 minutes). Both production-only and critical-level npm audits reported zero vulnerabilities. Final documentation formatting and `git diff --check` passed.

Final full-gate evidence is `.playwright/exports/ux-revision-final-validation.log`. The package is `release/datafog-1.0.0.zip`; packaging output is `.playwright/exports/ux-revision-package.log`.

Welcome progression (`WelcomeStep`) and content-copy lifecycle (`single.ts`) extend the ten behavior owners above to twelve.

## Existing-browser validation and repaired failures

The final combined gate passed formatting, lint, typecheck, build, **313 unit tests across 22 files, 67 controlled Chrome tests and all 15 authenticated live ChatGPT tests**, with no skipped or flaky live tests. Source stayed unchanged during the live run. Full output: `.playwright/exports/ux-final-all-checks.log`; preserved receipt: `.playwright/exports/ux-final-live-receipt.json` and `.txt` (run `3c16c150-477b-4e9c-9317-29a31ac9159e`).

The live suite uses the already-signed-in Chrome at the explicitly configured localhost endpoint. It temporarily disables only this checkout's original unpacked build, runs an independently installed test copy, uninstalls that owned copy and restores the original enabled state. After the final run, metadata confirmed the original `kmhhpopalkibmggpnfjdmegjmkamopec` enabled with no test copies remaining. Its vault was neither read nor reset. The optional manual-auth helper now launches ordinary Chrome and attaches automation only after human confirmation; it no longer preinstalls the extension.

Failures were retained and repaired without weakening assertions:

- The first live attempt stalled navigation and exposed cleanup comparing `/var` with Chrome's canonical `/private/var`. Ownership now captures canonical paths; a real-symlink regression covers failed installation cleanup. The known leaked test copy was removed explicitly; the original was preserved. Output: `.playwright/exports/ux-existing-browser-live.log`.
- The next navigation attempt confirmed the parent runner's synchronous child blocked its own CDP target events. Awaited asynchronous child execution fixes that deadlock, covered by a parent-event/child-handshake regression. Output: `.playwright/exports/ux-existing-browser-live-retry.log`; the same real detection test then passed in 3.1 seconds.
- The first complete live pass reached 14/15: current ChatGPT's answer actions sit ten ancestors above the response and use an accessible Copy label instead of the old test ID. The implementation now uses observed turn boundaries and the exact assistant action row, with a deep three-turn regression preventing cross-answer placement. Output: `.playwright/exports/ux-existing-browser-live-full.log`. Temporary structural diagnostics were removed; the unchanged Show/Hide test and final full suite passed.

## Review demo and limits

The final headed review uses Google Chrome `157.0.8103.80`, an isolated profile and a local ChatGPT-shaped fixture. Actual extension installation into an already-open tab passed with zero navigation or reload. The welcome page opened automatically and completed Pin → Done; the sidebar had two tabs and its gear opened settings. Dark appearance applied to settings, sidebar and circle even with light browser preference. No messages were sent.

Launcher: `.playwright/revision-manual.ts` (bundled runner `.playwright/revision-manual.mjs`). Open profile: `/var/folders/kt/xxfb4y954tbfw5mpmgm4ybq00000gn/T/datafog-revision-review-2t5NjF`; extension ID: `onemcikhbkmkhnaeoflnacffnebgbejj`. Screenshots under `.playwright/exports/`: `revision-welcome-pin.png`, `revision-welcome-done.png`, `revision-settings-dark.png`, `revision-sidebar-dark.png`, `revision-popup-dark.png`. The user's normal Chrome profile was not modified.

Chrome integration covers all five supported site profiles with controlled DOM fixtures. The final authenticated live suite passed all 15 tests on real ChatGPT using synthetic temporary-chat messages. Authenticated production markup on the other four sites was not smoke-tested.

Core's supported API cannot enumerate all historical mappings. Newly tracked markers appear in the sidebar; historical mappings remain restorable in answers or by explicit marker lookup, but unseen historical mappings cannot all be listed. No new retention expiry was introduced. Chrome profile access remains the trust boundary; there is no recovery password or backup feature. Loss of the local key makes saved originals unrecoverable through the extension, and inaccessible data is never silently reset.
