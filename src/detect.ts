/**
 * Detection with DataFog Core's WebAssembly build. Runs in the offscreen
 * document.
 */

import {
  init,
  scan,
  transform,
  type Finding,
  type TextRange,
  type TransformationConfig,
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
 * The smallest range covering two ranges.
 *
 * @param a One range.
 * @param b The other.
 * @returns Their union, including any gap between them.
 */
function cover(a: TextRange, b: TextRange): TextRange {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

/**
 * How much text a finding covers.
 *
 * @param finding The finding.
 * @returns Its length in UTF-16 code units.
 */
function length(finding: Finding): number {
  return finding.utf16Range.end - finding.utf16Range.start;
}

/**
 * Merge overlapping findings into one covering them all, typed as the longest.
 *
 * @param text The prompt the findings came from.
 * @param group Findings that overlap one another.
 * @returns One finding over their combined range.
 */
function merge(text: string, group: Finding[]): Finding {
  const longest = group.reduce((a, b) => (length(b) > length(a) ? b : a));
  const utf16Range = group.map((item) => item.utf16Range).reduce(cover);
  return {
    ...longest,
    matchedText: text.slice(utf16Range.start, utf16Range.end),
    utf16Range,
    byteRange: group.map((item) => item.byteRange).reduce(cover),
    codepointRange: group.map((item) => item.codepointRange).reduce(cover),
  };
}

/**
 * Merge findings that partly overlap, such as an email match that runs into
 * the phone number before it.
 *
 * Core won't transform partly overlapping findings without a review, and
 * redacting either one alone would leave part of the other showing. Findings
 * over the exact same range are left for Core, which picks one.
 *
 * @param text The prompt the findings came from.
 * @param findings The findings.
 * @returns Findings with no partial overlaps, in text order.
 */
function mergeOverlaps(text: string, findings: Finding[]): Finding[] {
  // A sorted copy; toSorted needs the ES2023 lib
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a copy
  const sorted = [...findings].sort(
    (a, b) => a.utf16Range.start - b.utf16Range.start,
  );
  const groups: Finding[][] = [];
  let end = -1;
  for (const finding of sorted) {
    const group = groups.at(-1);
    if (group && finding.utf16Range.start < end) group.push(finding);
    else groups.push([finding]);
    end = Math.max(end, finding.utf16Range.end);
  }
  return groups.flatMap((group) => {
    const [first] = group;
    const same = group.every(
      (item) =>
        item.utf16Range.start === first.utf16Range.start &&
        item.utf16Range.end === first.utf16Range.end,
    );
    return same ? group : [merge(text, group)];
  });
}

/**
 * Scan a prompt, with overlapping findings merged.
 *
 * @param text The prompt.
 * @param settings The current settings.
 * @returns Findings ready for transform.
 */
function findAll(text: string, settings: Settings): Finding[] {
  return mergeOverlaps(text, scan(text, { entities: settings.entities }));
}

/**
 * Count what a prompt contains, by type.
 *
 * Counts come from transform, not scan: scan reports every detector's match,
 * so one value matched by two detectors would count twice.
 *
 * @param text The prompt.
 * @param settings The current settings.
 * @returns Entity type to count; empty when nothing was found.
 */
export function countFindings(
  text: string,
  settings: Settings,
): Record<string, number> {
  if (!text.trim() || settings.entities.length === 0) return {};

  const { transformations } = transform(
    text,
    findAll(text, settings),
    redactConfig(settings),
  );

  const counts: Record<string, number> = {};
  for (const item of transformations) {
    counts[item.entityType] = (counts[item.entityType] ?? 0) + 1;
  }
  return counts;
}

/**
 * Replace each detected value with a label such as [EMAIL].
 *
 * @param text The prompt.
 * @param settings The current settings.
 * @returns The redacted prompt, and where each label replaced a value.
 */
export function redact(text: string, settings: Settings): RedactResponse {
  if (!text.trim() || settings.entities.length === 0) {
    return { text, edits: [] };
  }

  const result = transform(
    text,
    findAll(text, settings),
    redactConfig(settings),
  );
  return {
    text: result.text,
    edits: result.transformations.map((item) => ({
      start: item.sourceUtf16Range.start,
      end: item.sourceUtf16Range.end,
      replacement: item.replacement,
    })),
  };
}
