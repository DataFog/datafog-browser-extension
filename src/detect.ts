/**
 * Detection with DataFog Core's WebAssembly build. Runs in the offscreen
 * document.
 */

import {
  init,
  scan,
  transform,
  type Finding,
  type ScanConfig,
  type Transformation,
  type TransformationConfig,
  type WorkspaceFinding,
} from "@datafog/wasm";

import type { RedactResponse, ValueChoice, KeepPlace } from "./messages";
import { MODEL_ENTITIES, type Settings } from "./settings";

/**
 * Load the WebAssembly module. Safe to call more than once.
 *
 * @returns Resolves once Core is ready.
 */
export function ready(): Promise<void> {
  return init();
}

/** Finds the values of the given types, and the given phrases, in a prompt. */
export type Scanner = (
  text: string,
  entities: string[],
  deny?: string[],
) => Promise<Finding[]>;

/** Core's detector for phrases on the user's deny list. */
const DENY_DETECTOR = "datafog-core/denylist";

/**
 * Whether Core found a value because it's on the user's deny list.
 *
 * @param finding What Core found.
 * @returns True for a deny list phrase.
 */
function denied({ detectorName }: { detectorName?: string | null }): boolean {
  return detectorName === DENY_DETECTOR;
}

/**
 * Core's scan config for these types and phrases. Choosing UUID or a German
 * type isn't enough on its own: Core also needs its UUID switch or the German
 * locale.
 *
 * @param entities The types to find.
 * @param deny Phrases to always find, ignoring case, as whole words.
 * @returns The config to scan with.
 */
export function scanConfig(
  entities: string[],
  deny: string[] = [],
): ScanConfig {
  return {
    ...(entities.length > 0 && { entities }),
    ...(entities.includes("UUID") && { detect_uuid: true }),
    ...(entities.some((type) => type.startsWith("DE_")) && { locale: "de" }),
    ...(deny.length > 0 && {
      deny: deny.map((phrase) => ({ phrase, case_sensitive: false })),
    }),
  };
}

/**
 * Find values with Core's rules, synchronously in this document. Names and
 * addresses need the model, so they're skipped.
 *
 * @param text The prompt.
 * @param entities The types to find.
 * @param deny Phrases to always find.
 * @returns What Core found.
 */
export const scanRules: Scanner = async (text, entities, deny = []) => {
  const rules = entities.filter((type) => !MODEL_ENTITIES.includes(type));
  if (rules.length > 0) return scan(text, scanConfig(rules, deny));
  if (deny.length === 0) return [];
  // With no types, Core would run every rule: keep only the phrases
  return scan(text, scanConfig([], deny)).filter(denied);
};

/**
 * A value as Core matches a remembered choice: case and spacing don't count.
 *
 * @param entityType The value's type.
 * @param value The value.
 * @returns A key equal for values Core treats as the same.
 */
function choiceKey(entityType: string, value: string): string {
  const spaced = value.trim().replaceAll(/\s+/g, " ").toLowerCase();
  return `${entityType}\u0000${spaced}`;
}

/**
 * Leave out values remembered as not sensitive, as a review does.
 *
 * @param scanner Finds the values.
 * @param choices The remembered values; none while the vault is locked.
 * @returns A scanner that skips them.
 */
export function skipChoices(
  scanner: Scanner,
  choices: () => ValueChoice[],
): Scanner {
  return async (text, entities, deny) => {
    const found = await scanner(text, entities, deny);
    const known = new Set(
      choices().map(({ entityType, value }) => choiceKey(entityType, value)),
    );
    if (known.size === 0) return found;
    // A deny list phrase is found even if marked not sensitive, as in Core
    return found.filter(
      (finding) =>
        denied(finding) ||
        !known.has(choiceKey(finding.entityType, finding.matchedText)),
    );
  };
}

/**
 * Build the redaction config, including the user's allowlist.
 *
 * @param settings The current settings.
 * @returns A Core transformation config.
 */
function redactConfig(settings: Settings): TransformationConfig {
  const config: TransformationConfig = { default: { strategy: "redact" } };
  if (settings.allowlist.length === 0) return config;

  // Core's exact allowlist is per type; apply the user's list to every type
  const exact = Object.fromEntries(
    settings.entities.map((type) => [type, settings.allowlist]),
  );
  return { ...config, allow: { exact } };
}

/** DataFog's own markers, such as [[EMAIL_7KQ4ZM]], and labels, such as [EMAIL]. */
const PLACEHOLDER = /\[\[[A-Z][A-Z_]*_[A-Z0-9]+\]\]|\[[A-Z][A-Z_]*\]/g;

/**
 * Drop findings that touch DataFog's own markers or labels. The model can
 * read a marker as part of an address, and replacing part of one breaks it.
 *
 * @param text The prompt.
 * @param found What was found in it.
 * @returns The findings clear of every marker and label.
 */
function outsidePlaceholders(text: string, found: Finding[]): Finding[] {
  const spans = [...text.matchAll(PLACEHOLDER)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  if (spans.length === 0) return found;
  return found.filter(({ utf16Range: { start, end } }) =>
    spans.every((span) => end <= span.start || start >= span.end),
  );
}

/**
 * Whether the settings look for anything at all.
 *
 * @param settings The current settings.
 * @returns True if there are types or phrases to find.
 */
function looksForAnything(settings: Settings): boolean {
  return settings.entities.length > 0 || settings.denylist.length > 0;
}

/**
 * Find a prompt's values and decide which to replace: after the allowlist,
 * and with a value two detectors match once.
 *
 * @param text The prompt.
 * @param settings The current settings.
 * @param scanner Finds the values.
 * @returns One transformation per value; empty when nothing is checked.
 */
async function replaceable(
  text: string,
  settings: Settings,
  scanner: Scanner,
): Promise<Transformation[]> {
  if (!text.trim() || !looksForAnything(settings)) return [];
  const found = outsidePlaceholders(
    text,
    await scanner(text, settings.entities, settings.denylist),
  );
  return transform(text, found, redactConfig(settings)).transformations;
}

/**
 * Count what a prompt contains, by type.
 *
 * Counts come from transform, not scan: scan reports every detector's match,
 * so one value matched by two detectors would count twice.
 *
 * @param text The prompt.
 * @param settings The current settings.
 * @param scanner Finds the values.
 * @returns Entity type to count; empty when nothing was found.
 */
export async function countFindings(
  text: string,
  settings: Settings,
  scanner: Scanner,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const item of await replaceable(text, settings, scanner)) {
    counts[item.entityType] = (counts[item.entityType] ?? 0) + 1;
  }
  return counts;
}

/**
 * Replace each detected value with a label such as [EMAIL].
 *
 * @param text The prompt.
 * @param settings The current settings.
 * @param scanner Finds the values.
 * @returns The redacted prompt, and where each label replaced a value.
 */
export async function redact(
  text: string,
  settings: Settings,
  scanner: Scanner,
  keep: KeepPlace[] = [],
): Promise<RedactResponse> {
  const edits = (await replaceable(text, settings, scanner))
    .filter(
      (item) =>
        !keep.some(
          (place) =>
            place.start === item.sourceUtf16Range.start &&
            place.end === item.sourceUtf16Range.end,
        ),
    )
    .map((item) => ({
      start: item.sourceUtf16Range.start,
      end: item.sourceUtf16Range.end,
      replacement: item.replacement,
    }));
  let result = text;
  for (const edit of edits.toSorted((a, b) => b.start - a.start))
    result =
      result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  return { text: result, edits };
}

/**
 * Find the values Pseudonymize replaces: the same ones Redact would.
 *
 * @param text The prompt.
 * @param settings The current settings.
 * @param scanner Finds the values.
 * @returns Findings for a workspace review.
 */
export async function workspaceFindings(
  text: string,
  settings: Settings,
  scanner: Scanner,
): Promise<WorkspaceFinding[]> {
  const items = await replaceable(text, settings, scanner);
  return items.map((item) => ({
    entityType: item.entityType,
    matchedText: text.slice(
      item.sourceUtf16Range.start,
      item.sourceUtf16Range.end,
    ),
    range: { unit: "utf8_bytes", ...item.sourceByteRange },
    // Core keeps a deny list phrase in the review only by its detector
    detectorName: item.detectorName,
    detectorVersion: item.detectorVersion,
  }));
}
