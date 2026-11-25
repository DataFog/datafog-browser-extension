# Rampart detector evaluation

Rampart is the default name and address detector for 1.2.0. The DataFog CNN remains available in settings. The acceptance set favors Rampart on names. Its size limits what we can conclude about general accuracy.

## Reproduction and scope

Run `npm run build`, then `npx playwright test e2e/detectors.spec.ts`.
The test selects each detector through committed settings and calls the real
offscreen PDF scanner while the browser context is offline. Thus Core rule
findings and Core's transformation/overlap selection are included. Evidence is
in `detector-comparison.json` (10 locally authored synthetic examples, 11 gold
values). These fixtures are not a random sample. Training overlap is unknown;
no claim of independence from training data is made. We did not obtain or
reproduce Rampart's published held-out dataset or headline metrics.

Measured 2026-11-24, macOS 26.6.2 arm64, Chrome 158.0.8127.88. The first example
is a 4,257 UTF-16-unit document, exceeding one model token window. Each detector
starts cold, then processes the remaining nine short inputs on the same machine.

| Metric                                                |    CNN | Rampart |
| ----------------------------------------------------- | -----: | ------: |
| Gold values with any identifying letter/digit exposed | 8 / 11 |  0 / 11 |
| Exact span and type                                   | 3 / 11 | 11 / 11 |
| Entirely false replacement spans                      |      0 |       0 |
| Public letters/digits consumed by replacements        |      0 |       0 |
| Cold long-document scan, including startup            | 169 ms |  683 ms |
| Warm short-input median, nine examples                |   3 ms |   18 ms |

These timings include offscreen messaging, policy/vault access and transformation;
they are not isolated inference timings or end-to-end paste timings. Peak memory,
interactive paste contention and broad multilingual accuracy were not measured.

| Language                                 | Gold | CNN exact | Rampart exact |
| ---------------------------------------- | ---: | --------: | ------------: |
| English prose (including accented names) |    7 |         2 |             7 |
| Spanish                                  |    2 |         1 |             2 |
| French                                   |    1 |         0 |             1 |
| German                                   |    1 |         0 |             1 |

PERSON: CNN 0/8 exact, Rampart 8/8. ADDRESS: both 1/1. EMAIL: both 2/2.
Italian, Portuguese, Dutch and non-Latin scripts are untested. Two negative
English sentences produced no false findings; this is far too small to estimate
false-positive rates. No source extraction occurs in this detector-only test.

Examples missed by CNN and detected by Rampart include Nadia in prose,
Elara Whitcombe, Lucía Valdés, Élodie Moreau and Jürgen Weiß. Both protected the
entire multiline street/unit/city/region/postal address and rule-based emails.

## Boundary fixes and policy

An initial real-model run exposed an SDK 0.1.3 defect after an astral emoji:
`José Muñoz` became partial spans `osé ` and `uñoz. `, leaving initials exposed.
The worker replaces astral codepoints only in its inference copy with equal
UTF-16-length whitespace. Original source text is retained for final spans.
This prevents the SDK's mixed codepoint/UTF-16 projection from shifting later
findings. A production offline regression asserts the full accented name.
A second boundary fix extends spans over trailing combining marks, allowing
`Zoë Hartwell` to remain a single exact name. Unit tests cover byte/codepoint/
UTF-16 conversion, surrogate boundaries and component selection.

Rampart GIVEN_NAME/SURNAME map to PERSON; building number, street, unit, city,
state and postal code map to ADDRESS. Adjacent same-type components separated
only by whitespace or address punctuation merge before Core selection. Other
model labels are omitted; Core remains responsible for all deterministic types.
DataFog intentionally protects detected city/state/postal components when ADDRESS
is selected, unlike the upstream SDK's keep-set. Countries have no model label.
The worker retains SDK structured-identifier premasking and overlapping token
windows. Invalid coordinates or worker failure fail the scan; no silent CNN
fallback changes a committed review's policy.

## Distribution

The pinned model revision and hashes are in `assets/rampart/manifest.json`.
Builds verify hashes and copy local model, bundled SDK/Transformers worker and
matching ORT WASM/JSEP files. Remote model loading and browser cache are disabled.
The Rampart directory adds 39,203,030 unpacked bytes in the measured build;
compressed file payloads total approximately 17,331,883 bytes (zlib level 9,
not a complete release ZIP delta). Full PDF-enabled release footprint is separate.

SDK/model attribution, model card, CC BY 4.0, Transformers Apache 2.0 and ORT MIT
notices ship under `licenses/rampart/`. The npm ORT package includes its copyright
and MIT declaration in its JS header but omits the standalone license file; the
notice reproduces that declaration and MIT terms. Weights are unmodified.
