/**
 * Detection with the real Core WebAssembly build, outside the browser.
 */

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";

import { countFindings, ready, redact } from "./detect";
import { DEFAULT_ENTITIES, type Settings } from "./settings";

const settings: Settings = {
  enabled: true,
  entities: DEFAULT_ENTITIES,
  allowlist: [],
};
const prompt = "my email is jane@example.com and card 4111 1111 1111 1111";

beforeAll(async () => {
  // Node's fetch can't read files; hand the wasm over directly
  const wasm = readFileSync(
    "node_modules/@datafog/wasm/dist/datafog_wasm_bg.wasm",
  );
  globalThis.fetch = async () =>
    new Response(wasm, { headers: { "Content-Type": "application/wasm" } });
  await ready();
});

describe("countFindings", () => {
  test("counts each type found", () => {
    expect(countFindings(prompt, settings)).toEqual({
      EMAIL: 1,
      CREDIT_CARD: 1,
    });
  });

  test("counts a value two detectors match once", () => {
    // A labeled NPI is also phone-shaped
    const entities = [...DEFAULT_ENTITIES, "PHONE"];
    expect(
      countFindings("Provider NPI: 2125550100", { ...settings, entities }),
    ).toEqual({
      NPI: 1,
    });
  });

  test("leaves opt-in types off by default", () => {
    expect(countFindings("call 415-555-0123", settings)).toEqual({});
    expect(
      countFindings("call 415-555-0123", { ...settings, entities: ["PHONE"] }),
    ).toEqual({
      PHONE: 1,
    });
  });

  test("skips allowlisted values", () => {
    const allowed = { ...settings, allowlist: ["jane@example.com"] };
    expect(countFindings(prompt, allowed)).toEqual({ CREDIT_CARD: 1 });
  });

  test("returns nothing when no types are selected or no text is typed", () => {
    expect(countFindings(prompt, { ...settings, entities: [] })).toEqual({});
    expect(countFindings("   ", settings)).toEqual({});
  });
});

describe("redact", () => {
  test("replaces each value with its label", () => {
    expect(redact(prompt, settings).text).toBe(
      "my email is [EMAIL] and card [CREDIT_CARD]",
    );
  });

  test("reports each value's range in the original text", () => {
    const { edits } = redact(prompt, settings);
    expect(
      edits.map((edit) => [
        prompt.slice(edit.start, edit.end),
        edit.replacement,
      ]),
    ).toEqual([
      ["jane@example.com", "[EMAIL]"],
      ["4111 1111 1111 1111", "[CREDIT_CARD]"],
    ]);
  });

  test("keeps allowlisted values", () => {
    const allowed = { ...settings, allowlist: ["jane@example.com"] };
    expect(redact(prompt, allowed).text).toBe(
      "my email is jane@example.com and card [CREDIT_CARD]",
    );
  });
});
