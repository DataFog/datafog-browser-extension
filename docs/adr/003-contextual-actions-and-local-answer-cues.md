# ADR 003: Contextual draft actions and local answer cues

- **Status:** Implemented; validation recorded in the UX handoff
- **Date:** 2026-11-22
- **Scope:** UX polish on `v1-ux-updates`; FogVault identifiers, cryptography and persistent formats remain unchanged

## Send intent belongs to the current draft

A proactive popup offers Keep as is and Replace. Neither sends a message. A send intercepted by the optional hold-sends setting instead offers Send as is and Replace & send. The latter is explicit approval to transform and send that draft: save originals durably, apply the exact accepted preview to the unchanged editor, then invoke the site's send control once. A failed or uncertain save, invalid application, changed draft or changed policy must not release a send.

Repeated native send clicks remain held. A distinct Enter while the popup is open activates its primary action; the Enter that opened the interception cannot also activate it. Repeated keydown and IME composition cannot trigger a send. Escape dismisses the menu or popup and preserves a usable focus target. The one permitted native send is scoped to the completed operation, not a reusable bypass.

## Paste replacement is an opt-in draft operation

`autoReplaceOnPaste` defaults to false, including when older encrypted preferences lack the field. It is stored with encrypted checking preferences, not with the nonsensitive theme bootstrap enum. Enabling it lets a paste request replacement for that current draft after checking. The existing save-before-apply and revision/policy guards still apply. Pasting never authorizes sending.

Manual and paste replacements expose a brief nearby “Replaced n items · Undo” confirmation. Undo belongs to the unchanged transformed revision and becomes unavailable after unrelated editing. Redact's “Not saved to vault” subtitle describes its lack of a durable mapping without implying that immediate local Undo is impossible.

## Originals are visibly local and explicitly copied

Each answer toggles Show originals and Show tokens. Restored spans have a restrained tint/dotted cue and a tooltip identifying the underlying token. Provider message nodes retain their token text; one answer's display/read state does not control another answer. Streaming, replacement, removal, forgetting a mapping and stale reads invalidate the appropriate local display.

Copy with originals is a separate explicit action using the current answer version. Unknown tokens stay unchanged with a partial-result notice. A stale or failed read cannot copy an older answer. The provider's ordinary Copy action is neither intercepted nor relabeled and continues to copy its own token-bearing answer.

## Visual hierarchy and onboarding

Original values carry the primary visual emphasis; preview tokens and arrows are secondary. Saved values are visually shortened in the middle while their full original remains available to hover, search and explicit copying. Allowed belongs beside the type label. Dark-mode circle and tooltip contrast remain legible. The welcome CTA chooses the active supported chat tool, then the most recently used supported tool, with ChatGPT as the fallback; it navigates only to supported origins.

These changes introduce no background sending, additional host permissions or new storage format. Chrome profile access remains the trust boundary.

Popup entrance and quick Undo use restrained 140 ms motion; the circle transitions color and halo without moving its click target. Reduced-motion preferences disable these animations and transitions. Closing remains immediate.
