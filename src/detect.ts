/**
 * Detection with DataFog Core's WebAssembly build. Runs in the offscreen
 * document.
 */

import {
  init,
  scan,
  transform,
  type Finding,
  type Transformation,
  type TransformationConfig,
  type WorkspaceFinding,
} from "@datafog/wasm";

import type { RedactResponse } from "./messages";
import type { Settings } from "./settings";

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
 * Find values with Core's rules, synchronously in this document.
 *
 * @param text The prompt.
 * @param entities The types to find.
 * @returns What Core found.
 */
export const scanRules: Scanner = async (text, entities) =>
  scan(text, { entities });

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
  const found = await scanner(text, settings.entities);
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
  const found = await scanner(text, settings.entities);
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
