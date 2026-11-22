# ADR 003: Contextual draft actions and local answer cues

- **Status:** Implemented; validation recorded in the UX handoff
- **Date:** 2026-11-22
- **Scope:** UX polish on `v1-ux-updates`; FogVault identifiers, cryptography and persistent formats remain unchanged

## Send intent belongs to the current draft

A proactive popup lets each included occurrence choose Replace or Redact, then applies the accepted mixed plan once. Unchecked occurrences stay as typed. Replace rows enter Core’s retained preparation and durable encrypted commit; Redact rows use Core labels without saving those originals. The combined editor change has one Undo/Redo entry. No proactive action sends a message. A send intercepted by the optional hold-sends setting offers Apply & send, or Send as is when every row is unchecked. A failed or uncertain save, invalid application, changed draft or changed policy must not release a send. Closing the popup does not suppress findings. Lasting allow exceptions belong to Rules and saved-original menus, and Chrome’s toolbar action opens the sidebar.

Repeated native send clicks remain held. A distinct Enter while the popup is open activates its primary action; the Enter that opened the interception cannot also activate it. Repeated keydown and IME composition cannot trigger a send. Escape dismisses the popup and preserves a usable focus target. The one permitted native send is scoped to the completed operation, not a reusable bypass.

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

The final welcome step includes three short, silent walkthrough clips using a fictional email address. Videos and still posters ship inside the extension, with no external media requests. The Getting started screen uses manual previous/next navigation and dots, with no automatic slide advance. Only the selected clip loops; an accessible icon button pauses or resumes it. The replacement demonstration lasts six seconds and the other two last three seconds. Secondary explanatory copy is kept out of the visible slideshow. Reduced motion keeps the poster visible until the user explicitly plays a clip. The pin step, conditional reload fallback, and current-tool CTA remain available.

Selected Replace and Redact modes share a neutral gray treatment, backed by stronger borders, bold labels and accessible pressed state in both themes. The two tooltip explanations occupy separate lines. Wide rows align original, marker and mode controls; narrow rows wrap controls and retain full-value titles. Primary hover and keyboard focus preserve readable foreground/background contrast. The sidebar does not repeat Chrome’s native extension name or logo.
