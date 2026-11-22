# V1 UX implementation handoff

## Review state

- Local branch: `v1-ux-updates`.
- Baseline: latest `origin/main` at `3568adfa6c714a7d233efd5eeae54978b63c23e7`.
- Implementation and validation completed before committing; the owner subsequently authorized a PR, with no merge. Unrelated `.devcontainer/` and original local work were preserved; the supplied revision patch intentionally updates `docs/ux/explicit-state-machines.md`.
- The interface calls the store vault; FogVault published package names and persistent identifiers were retained. The proposed storage rename was explicitly deferred.

## Approved mixed-popup revision validation

The approved revision uses per-occurrence Replace/Redact choices and one Apply, neutral selected states, inline desktop rows with a narrow-screen fallback, a Close-only popup header and the native Chrome sidebar title. Refreshed local onboarding clips show this UI (6/3/3 seconds, silent VP9); storyboard captures use fictional values and zero sends.

Validation passed **389 unit tests across 24 files**, formatting, lint, type checking and packaging. The complete controlled Chrome run exercised 83 tests: 81 passed initially, while two new contrast checks incorrectly treated translucent selected backgrounds as opaque. The test now composites their computed RGBA paint over the actual popup surface before measuring contrast; both corrected light/dark checks passed with the unchanged 4.5:1 threshold. All 83 controlled journeys therefore passed across the full run and focused correction, with no product changes between them. Evidence: `.playwright/exports/mixed-final-unit.log`, `mixed-final-controlled.log`, and `mixed-final-contrast-corrected.log`. The ordinary commit hook remains the final authenticated 17-test gate and preserves a separate receipt.

## Implemented behavior

The circle previews the current draft's findings and markers. The displayed concrete marker comes from the exact retained Core preparation, identified by a preview token. Core supports one live preparation per workspace: another tab or a policy change can expire that token. Apply then preserves the draft, refreshes the preview and requires an intentional retry; it never silently inserts a different code. Each included row selects Replace or Redact. Apply saves only Replace originals before applying the exact combined plan, with one Undo/Redo entry; skipped occurrences remain as typed. Close dismisses without suppressing findings. Rules and saved-original menus own lasting allow exceptions; Chrome’s toolbar opens the sidebar. The floating page tab is removed.

Answers independently toggle known originals in extension-owned display, including repeated and adjacent markers. Provider text stays unchanged. Unknown markers remain markers and receive a partial-result notice when mixed with known markers. The sidebar has exactly two tabs, Originals and Rules. Its gear opens settings, which owns checking preferences, appearance and vault deletion.

FogVault opens automatically with a local non-extractable key. Original mappings, typed exceptions, literal allow/flag rules and checking preferences are encrypted. Only the nonsensitive appearance enum is an explicit plaintext bootstrap exception. Password-only stores are not supported; vault access uses the local device key automatically. Missing keys and storage corruption preserve existing data and show unavailable checking. Deletion requires confirmation and retains recovery state for partial failures.

See [ADR 002](adr/002-automatic-fogvault-ux.md) for superseded decisions, matching semantics, key boundaries, deletion scope and retained requirements.

## State ownership

| Behavior                         | Owner                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Circle and popup                 | `CircleSurface` derives visibility from the owning DOM; `BadgeState` projects checking status |
| Sidebar                          | `activeView` and access union in `panel.ts`                                                   |
| Draft scanning                   | `ScanState`, sequence, draft revision and policy token in `content.ts`                        |
| Draft transformation and history | `ActionState`, operation ID, revision and `Redaction` history in `content.ts`                 |
| Send blocking                    | `SendState` plus IME/repeated-key guards                                                      |
| Per-answer original display      | `AnswerState`, content version and scoped overlay in `originals.ts`                           |
| Automatic storage access         | `AccessState` in `offscreen.ts`                                                               |
| Commit/reconciliation            | `CommitState` in `vault.ts`                                                                   |
| Rules/preferences                | `PolicyState`, verified ciphertext writes and committed policy token                          |
| Deletion/recovery                | `DeletionState` in `vault.ts`, durable deletion metadata and settings confirmation state      |

## November 22: contextual actions and local-original clarity

Held sends offer Apply & send, or Send as is when every finding is unchecked. Apply & send releases exactly one native send only after durable saving and application of the current accepted preview; Send as is explicitly releases the unchanged draft. Repeated native button clicks keep the choice available; proactive Apply never sends. Keyboard activation distinguishes an already-open popup from the Enter that opened it, with repeated-key and IME guards.

Automatically replace on paste is off by default and stored with encrypted preferences. Opted-in pastes replace locally after saving and never send. Manual and pasted replacements expose quick Undo. The mode tooltip explains that Redact removes details without saving originals, while Replace saves originals and inserts reversible tokens. Per-answer Show originals / Show tokens uses local highlighted values with token tooltips; Copy with originals is separate from native Copy and rejects stale answer reads. Preview tokens have quieter styling, long saved originals retain their suffix and full hover value, and the welcome CTA chooses the current supported tool. See [ADR 003](adr/003-contextual-actions-and-local-answer-cues.md).

Browser validation uses genuine keyboard, mouse and OS clipboard input against all five controlled site profiles. Each controlled native send records the payload at the send event, so tests verify that replacements are applied before sending. Synthetic authenticated ChatGPT checks continue to use the existing signed-in browser with the original extension temporarily suspended and restored, without resetting its vault.

Local validation passed **369 unit tests in 23 files and 78 controlled Chrome tests**, plus formatting, lint and type checks. After the final scoped answer-theme fix, all five affected answer journeys and the complete unit/static gates passed again (`nov22-theme-final.log`). The final controlled run includes normal/reduced-motion computed-style assertions and genuine Undo clicks. Log: `.playwright/exports/nov22-final-motion-local.log`. The ordinary pre-commit hook is the final authenticated gate and runs all 17 live ChatGPT tests against the exact staged implementation; its receipt records the source fingerprint and result. The PR must not merge automatically.

Initial browser failures were retained in `.playwright/exports/nov22-focused-browser.log`, `nov22-focused-browser-recheck.log` and `nov22-fixed-focused.log`. Stale copy/status text expectations were updated for the requested wording. Real failures exposed repeated native Send closing the held-choice popup and the manual Undo toast either missing or overlapping the open popup. The implementation now reopens held choices and reserves space for the toast. Exact keyboard/mouse Undo failed three times before the layout fix and passed all three repetitions afterward (`nov22-toast-exact.log`, `nov22-toast-fixed.log`). No send, save, clipboard or Undo assertions were dropped. Final visual review also exposed local originals retaining light-theme text color after a dark-mode switch. A new browser assertion failed before the fix (`nov22-answer-theme-before-fix.log`); the local clone now refreshes its appearance while preserving the shown answer and provider text. All five supported fixtures verify both dark and light transitions.

The first ordinary live hook passed 15/17 and stopped the commit (`nov22-commit-hook.log`). Real ChatGPT exposed a transparent badge wrapper intercepting native Send outside all painted controls; only painted controls now receive pointer events. A new browser regression verifies the exact native hit target and sent payload. The paste test also inherited an earlier synthetic ChatGPT draft; it now asserts an empty owned composer before pasting and requires the exact transformed sample, retaining count, Undo and no-send assertions. The final affected browser run passed **53/53**, including that new hit-area test; the controlled suite now contains 79 tests (`nov22-final-hit-safety.log`).

Browser-level diagnostics initially appeared to lose the original installation. Chrome actually had multiple regular profiles, and unpinned extension inventory, page creation and authentication checks did not consistently refer to the same profile. The earlier unpinned “ready” result is not evidence that the Default vault recovered. The harness now requires the verified browser context of an existing signed-in ChatGPT tab, opens owned tabs through that verified opener, validates target/worker context, and foregrounds its bound extension-management page before browser-level operations. It never silently falls back to another profile. One runner owns suspension and restoration; an isolated checkout supplies an explicit original ID/path pair, validated against the selected profile, rather than nesting suspension wrappers. Live builds use a temporary output tree; ordinary builds preserve directory identity.

In verified **Default**, original ID `kmhhpopalkibmggpnfjdmegjmkamopec` is enabled, and the proven disposable orphan was removed after its installation time matched our diagnostic run. The original vault currently reports **`vault_key_missing` / unavailable**: routing exists, `automatic:false`, and its local unlocking key is missing. IndexedDB/settings metadata were retained and backed up opaquely. No original-vault reset, key recovery or data restoration was attempted. This is an explicit limitation of the user's loaded Default installation, separate from the disposable stores used for tests. Evidence: `nov22-default-status.log`, `nov22-owned-orphan-cleanup.log`; the earlier `nov22-original-restoration.log` was not profile-bound.

After profile pinning, the real response/copy/Forget journey passed. Native keyboard clearing fixed the paste test's rich-editor setup; a remaining real paste failure then exposed provider listener ordering. Observing paste in capture phase records the pre-edit draft before the provider's already-registered handler inserts it. A regression failed before that one-line fix and passed afterward. The real paste/Undo/no-send journey passed in 3.3 seconds (`nov22-pinned-live-paste-fixed.log`). The second full hook's authentication failures were followed by a verified signed-in Default session. The unpinned failures did not establish a sign-out; no new sign-in or browser profile was required. The final ordinary hook must pass all 17 cases before a commit.

Review screenshots under `.playwright/exports/nov22-*` cover light/dark popups on all five supported fixtures, a 320 px sidebar with the long original's suffix visible, local answer cues and quick Undo. Authenticated provider coverage remains ChatGPT only; the other four sites use controlled DOM fixtures. Existing FogVault identifiers and the user's unrelated local work are preserved.

## Revision 7: choosing findings and saved-original actions

The popup now starts with each occurrence chosen. Unchecking keeps that occurrence as typed, including when the same original appears more than once. Selection is identified by UTF-16 source ranges and guarded by draft, tab, preview and committed policy identity. Apply uses the exact prepared mixed plan: Replace saves reversible markers and Redact uses labels without saving those originals. With nothing chosen, proactive Apply is disabled; a held draft offers explicit Send as is. Same-draft rescans retain choices and row modes, while edits reset them. Lasting allow exceptions are managed separately in Rules and saved-original menus.

Saved-original rows offer Copy original, Always allow this value and confirmed Forget. Typed allowances show an Allowed chip. Forget uses Core's existing token-retirement API and durable commit/reconciliation boundary, removes the row and hides already-shown originals without changing provider messages. Cancellation and confirmed failures preserve mappings; uncertain writes are reconciled. No cryptography, database format or detector policy was changed.

Validation: **331 unit tests across 22 files, 69 controlled Chrome tests, and all 16 authenticated ChatGPT tests passed**, with zero skips or flaky live results. The existing signed-in browser was used; no new authentication flow was needed. Full log: `.playwright/exports/revision7-final-all-checks.log`; preserved live receipt: `.playwright/exports/revision7-live-receipt.json` and `.txt`, run `4b9b6bee-3db6-4ccf-8141-d791ecbd74ed`. The final menu/kept-chip styling was additionally checked with the affected browser journeys and screenshots. A follow-up test initially clicked before an edited draft finished rechecking: the retained count and Replace label were not readiness signals. The trace showed Replace correctly disabled. The test now explicitly waits for actionable fresh results without dropping any assertion; all three affected journeys passed three consecutive repetitions (9/9). Failure output: `.playwright/exports/revision7-final-style-validation.log`; verified reruns: `.playwright/exports/revision7-style-journeys-verified.log`. Backend tests cover stale selection, repeated Unicode occurrences, all-kept reservations and uncertain Forget reconciliation; UI tests cover late selection responses, same-draft rescan retention, copy failure and pending/failed row actions.

The disposable headed review is `.playwright/revision7-review.ts`, profile `/var/folders/kt/xxfb4y954tbfw5mpmgm4ybq00000gn/T/datafog-revision7-review-HlkVuO` (extension `bhejppobjnbdodobnbbgdpblilpmmojg`). Screenshots `.playwright/exports/revision7-choose-skip.png`, `revision7-original-menu.png` and `revision7-forget-confirm.png` were visually checked against the supplied references. The fixture sent no messages. The authenticated tests used synthetic temporary chats and removed their separately owned extension copies afterward; the existing installation and vault were preserved.

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

Welcome progression (`WelcomeStep`), content-copy lifecycle (`single.ts`), draft selection and saved-original row actions extend the ten behavior owners above to fourteen.

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
