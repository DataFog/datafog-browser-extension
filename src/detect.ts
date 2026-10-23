/**
 * Detection with DataFog Core's WebAssembly build. Runs in the service worker.
 */

import {
  init,
  scan,
  scanAndTransform,
  transform,
  type TransformationConfig,
} from "@datafog/wasm";

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

  const found = scan(text, { entities: settings.entities });
  const { transformations } = transform(text, found, redactConfig(settings));

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
 * @returns The redacted prompt.
 */
export function redact(text: string, settings: Settings): string {
  if (!text.trim() || settings.entities.length === 0) return text;

  return scanAndTransform(text, {
    scan: { entities: settings.entities },
    transform: redactConfig(settings),
  }).text;
}
