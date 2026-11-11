/**
 * Detection with the real Core WebAssembly build, outside the browser.
 */

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";

import {
  countFindings as countWith,
  ready,
  redact as redactWith,
  scanRules,
  workspaceFindings as findingsWith,
} from "./detect";
import { DEFAULT_ENTITIES, type Settings } from "./settings";

const settings: Settings = {
  enabled: true,
  entities: DEFAULT_ENTITIES,
  allowlist: [],
  blockSends: false,
};
const countFindings = (text: string, chosen: Settings) =>
  countWith(text, chosen, scanRules);
const redact = (text: string, chosen: Settings) =>
  redactWith(text, chosen, scanRules);
const workspaceFindings = (text: string, chosen: Settings) =>
  findingsWith(text, chosen, scanRules);
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
  test("counts each type found", async () => {
    expect(await countFindings(prompt, settings)).toEqual({
      EMAIL: 1,
      CREDIT_CARD: 1,
    });
  });

  test("counts a value two detectors match once", async () => {
    // A labeled NPI is also phone-shaped
    const entities = [...DEFAULT_ENTITIES, "PHONE"];
    expect(
      await countFindings("Provider NPI: 2125550100", {
        ...settings,
        entities,
      }),
    ).toEqual({
      NPI: 1,
    });
  });

  test("leaves opt-in types off by default", async () => {
    expect(await countFindings("call 415-555-0123", settings)).toEqual({});
    expect(
      await countFindings("call 415-555-0123", {
        ...settings,
        entities: ["PHONE"],
      }),
    ).toEqual({
      PHONE: 1,
    });
  });

  test("skips allowlisted values", async () => {
    const allowed = { ...settings, allowlist: ["jane@example.com"] };
    expect(await countFindings(prompt, allowed)).toEqual({ CREDIT_CARD: 1 });
  });

  test("returns nothing when no types are selected or no text is typed", async () => {
    expect(await countFindings(prompt, { ...settings, entities: [] })).toEqual(
      {},
    );
    expect(await countFindings("   ", settings)).toEqual({});
  });
});

describe("redact", () => {
  test("replaces each value with its label", async () => {
    expect((await redact(prompt, settings)).text).toBe(
      "my email is [EMAIL] and card [CREDIT_CARD]",
    );
  });

  test("reports each value's range in the original text", async () => {
    const { edits } = await redact(prompt, settings);
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

  test("keeps allowlisted values", async () => {
    const allowed = { ...settings, allowlist: ["jane@example.com"] };
    expect((await redact(prompt, allowed)).text).toBe(
      "my email is jane@example.com and card [CREDIT_CARD]",
    );
  });
});

describe("workspaceFindings", () => {
  test("gives each value once, with its UTF-8 byte range", async () => {
    const text = "café jane@example.com";
    expect(await workspaceFindings(text, settings)).toEqual([
      {
        entityType: "EMAIL",
        matchedText: "jane@example.com",
        range: { unit: "utf8_bytes", start: 6, end: 22 },
      },
    ]);
  });

  test("leaves out allowlisted values", async () => {
    const allowed = { ...settings, allowlist: ["jane@example.com"] };
    expect(
      (await workspaceFindings(prompt, allowed)).map((item) => item.entityType),
    ).toEqual(["CREDIT_CARD"]);
  });
});
