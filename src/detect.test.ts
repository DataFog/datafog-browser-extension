/**
 * Detection with the real Core WebAssembly build, outside the browser.
 */

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";

import {
  countFindings as countWith,
  ready,
  redact as redactWith,
  scanConfig,
  scanRules,
  skipChoices,
  workspaceFindings as findingsWith,
  type Scanner,
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

  test("leaves names and addresses to the model", async () => {
    const text = "John Smith, jane@example.com";
    expect(
      await countFindings(text, { ...settings, entities: ["PERSON", "EMAIL"] }),
    ).toEqual({ EMAIL: 1 });
    expect(
      await countFindings(text, { ...settings, entities: ["ADDRESS"] }),
    ).toEqual({});
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

// Stands in for the model reading a marker as part of an address
const greedy: Scanner = async (text) => {
  const at = text.indexOf("MPC9QD]]");
  return at === -1
    ? []
    : [
        {
          entityType: "ADDRESS",
          matchedText: "MPC9QD]]",
          byteRange: { start: at, end: at + 8 },
          codepointRange: { start: at, end: at + 8 },
          utf16Range: { start: at, end: at + 8 },
          detectorName: "model",
        },
      ];
};

describe("markers and labels", () => {
  test("never flags part of a marker or label", async () => {
    const text = "Ship to [[ADDRESS_MPC9QD]] and [EMAIL]";
    const chosen = { ...settings, entities: ["ADDRESS"] };
    expect(await countWith(text, chosen, greedy)).toEqual({});
    expect((await redactWith(text, chosen, greedy)).text).toBe(text);
  });

  test("still finds values beside a marker", async () => {
    const text = "[[EMAIL_7KQ4ZM]] and jane@example.com";
    expect(await countFindings(text, settings)).toEqual({ EMAIL: 1 });
  });
});

describe("labeled values", () => {
  test("finds labeled account numbers and street addresses by default", async () => {
    const text =
      "Account number: 00123456\nShipping address: 12 Willow Road, Anytown";
    expect(await countFindings(text, settings)).toEqual({
      ACCOUNT_NUMBER: 1,
      STREET_ADDRESS: 1,
    });
  });
});

describe("UUIDs", () => {
  const text = "order 123e4567-e89b-12d3-a456-426614174000";

  test("leaves UUIDs alone by default", async () => {
    expect(await countFindings(text, settings)).toEqual({});
  });

  test("finds UUIDs once turned on", async () => {
    const chosen = { ...settings, entities: [...DEFAULT_ENTITIES, "UUID"] };
    expect(await countFindings(text, chosen)).toEqual({ UUID: 1 });
  });
});

describe("scanConfig", () => {
  test("turns on UUIDs and German types only when chosen", () => {
    expect(scanConfig(["EMAIL"])).toEqual({ entities: ["EMAIL"] });
    expect(scanConfig(["EMAIL", "UUID", "DE_IBAN"])).toEqual({
      entities: ["EMAIL", "UUID", "DE_IBAN"],
      detect_uuid: true,
      locale: "de",
    });
  });

  test("finds UUIDs and German values with the rules", async () => {
    const text =
      "id 123e4567-e89b-12d3-a456-426614174000, DE44500105175407324931";
    const found = await scanRules(text, ["UUID", "DE_IBAN"]);
    expect(found.map((item) => item.entityType)).toEqual(["UUID", "DE_IBAN"]);
  });
});

describe("skipChoices", () => {
  const remembered = skipChoices(scanRules, () => [
    { entityType: "EMAIL", value: " JANE@example.com " },
  ]);

  test("skips a remembered value, whatever its case or spacing", async () => {
    expect(await countWith(prompt, settings, remembered)).toEqual({
      CREDIT_CARD: 1,
    });
    expect((await redactWith(prompt, settings, remembered)).text).toBe(
      "my email is jane@example.com and card [CREDIT_CARD]",
    );
  });

  test("still finds the same text as another type", async () => {
    const other = skipChoices(scanRules, () => [
      { entityType: "PERSON", value: "jane@example.com" },
    ]);
    expect(await countWith(prompt, settings, other)).toEqual({
      EMAIL: 1,
      CREDIT_CARD: 1,
    });
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
