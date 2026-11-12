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

import type { RedactResponse, ValueChoice } from "./messages";
import { MODEL_ENTITIES, type Settings } from "./settings";

/**
 * Load the WebAssembly module. Safe to call more than once.
 *
 * @returns Resolves once Core is ready.
 */
export function ready(): Promise<void> {
  return init();
}

/** Finds the values of the given types in a prompt. */
export type Scanner = (text: string, entities: string[]) => Promise<Finding[]>;

/**
 * Core's scan config for these types. Choosing UUID or a German type isn't
 * enough on its own: Core also needs its UUID switch or the German locale.
 *
 * @param entities The types to find.
 * @returns The config to scan with.
 */
export function scanConfig(entities: string[]): ScanConfig {
  return {
    entities,
    ...(entities.includes("UUID") && { detect_uuid: true }),
    ...(entities.some((type) => type.startsWith("DE_")) && { locale: "de" }),
  };
}

/**
 * Find values with Core's rules, synchronously in this document. Names and
 * addresses need the model, so they're skipped.
 *
 * @param text The prompt.
 * @param entities The types to find.
 * @returns What Core found.
 */
export const scanRules: Scanner = async (text, entities) => {
  const rules = entities.filter((type) => !MODEL_ENTITIES.includes(type));
  return rules.length === 0 ? [] : scan(text, scanConfig(rules));
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
  return async (text, entities) => {
    const found = await scanner(text, entities);
    const known = new Set(
      choices().map(({ entityType, value }) => choiceKey(entityType, value)),
    );
    if (known.size === 0) return found;
    return found.filter(
      ({ entityType, matchedText }) =>
        !known.has(choiceKey(entityType, matchedText)),
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
  if (!text.trim() || settings.entities.length === 0) return [];
  const found = outsidePlaceholders(
    text,
    await scanner(text, settings.entities),
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
): Promise<RedactResponse> {
  if (!text.trim() || settings.entities.length === 0) {
    return { text, edits: [] };
  }
  const found = outsidePlaceholders(
    text,
    await scanner(text, settings.entities),
  );
  const result = transform(text, found, redactConfig(settings));
  return {
    text: result.text,
    edits: result.transformations.map((item) => ({
      start: item.sourceUtf16Range.start,
      end: item.sourceUtf16Range.end,
      replacement: item.replacement,
    })),
  };
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
  }));
}
