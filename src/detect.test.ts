/**
 * Detection with the real Core WebAssembly build, outside the browser.
 */

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";

import { countFindings, ready, redact } from "./detect";
import { DEFAULT_ENTITIES, OPT_IN_ENTITIES, type Settings } from "./settings";

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

  test("covers an email match that runs into the phone number before it", () => {
    // The email detector reads "555-0123/jane" as the email's local part
    const text = "Acme Events/Jane Roe/(555)555-0123/jane@example.com";
    const entities = [...DEFAULT_ENTITIES, "PHONE"];

    expect(redact(text, { ...settings, entities }).text).toBe(
      "Acme Events/Jane Roe/[EMAIL]",
    );
    expect(countFindings(text, { ...settings, entities })).toEqual({
      EMAIL: 1,
    });
  });

  test("keeps allowlisted values", () => {
    const allowed = { ...settings, allowlist: ["jane@example.com"] };
    expect(redact(prompt, allowed).text).toBe(
      "my email is jane@example.com and card [CREDIT_CARD]",
    );
  });
});

describe("adjacent values", () => {
  // One value per type, joined by separators that detectors tend to run past
  const values = [
    "jane@example.com",
    "(555)555-0123",
    "+1 555 555 0123",
    "219-09-9999",
    "4111 1111 1111 1111",
    "2024-01-15",
    "Jan 15, 2024",
    "94105-1234",
    "192.168.1.10",
    "2001:db8::1",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "postgres://admin:s3cret@db.example.com:5432/app",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "NPI: 1234567893",
    "routing number 021000021",
  ];
  const separators = [
    "/",
    " ",
    ", ",
    "|",
    ":",
    "-",
    "",
    ";",
    "\n",
    "_",
    ".",
    "=",
  ];
  const all = {
    ...settings,
    entities: [...DEFAULT_ENTITIES, ...OPT_IN_ENTITIES],
  };

  test("count and redact without an overlap failure", () => {
    for (const first of values) {
      for (const second of values) {
        for (const separator of separators) {
          const text = first + separator + second;
          expect(() => countFindings(text, all), text).not.toThrow();
          expect(() => redact(text, all), text).not.toThrow();
        }
      }
    }
  });
});
