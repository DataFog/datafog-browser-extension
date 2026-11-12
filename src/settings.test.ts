/**
 * Every type the settings offer, or may offer, has a plain-language name, and
 * none appears twice.
 */

import { expect, test } from "vitest";

import {
  DEFAULT_ENTITIES,
  GERMAN_ENTITIES,
  LABELS,
  OPT_IN_ENTITIES,
} from "./settings";

const OFFERED = [...DEFAULT_ENTITIES, ...OPT_IN_ENTITIES, ...GERMAN_ENTITIES];

test("names every offered type", () => {
  expect(OFFERED.filter((type) => !LABELS[type])).toEqual([]);
});

test("offers each type once", () => {
  expect(new Set(OFFERED).size).toBe(OFFERED.length);
});
