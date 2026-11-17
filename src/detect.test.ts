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
import { DEFAULT_ENTITIES, GERMAN_ENTITIES, type Settings } from "./settings";

const settings: Settings = {
  enabled: true,
  off: [],
  entities: DEFAULT_ENTITIES,
  allowlist: [],
  denylist: [],
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

describe("German identifiers", () => {
  const text = "IBAN DE44 5001 0517 5407 3249 31, Steuer-ID: 12 345 678 901";

  test("leaves German values alone by default", async () => {
    expect(await countFindings(text, settings)).toEqual({});
  });

  test("finds German values once turned on", async () => {
    const chosen = {
      ...settings,
      entities: [...DEFAULT_ENTITIES, ...GERMAN_ENTITIES],
    };
    expect(await countFindings(text, chosen)).toEqual({
      DE_IBAN: 1,
      DE_TAX_ID: 1,
    });
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
      expect.objectContaining({
        entityType: "EMAIL",
        matchedText: "jane@example.com",
        range: { unit: "utf8_bytes", start: 6, end: 22 },
        detectorName: "datafog-core/email",
      }),
    ]);
  });

  test("leaves out allowlisted values", async () => {
    const allowed = { ...settings, allowlist: ["jane@example.com"] };
    expect(
      (await workspaceFindings(prompt, allowed)).map((item) => item.entityType),
    ).toEqual(["CREDIT_CARD"]);
  });
});

// Pattern coverage belongs beside Core's real WASM tests, independent of page DOM.
describe("rule detector samples", () => {
  test.each([
    ["API_KEY", "api_key=sk_live_abcdefghijklmnopqrstuvwxyz012345"],
    [
      "BEARER_TOKEN",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    ],
    [
      "CREDENTIAL_URI",
      "postgres://testuser:testpassword@localhost:5432/testdb",
    ],
    [
      "JWT",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    ],
    [
      "PRIVATE_KEY",
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----",
    ],
    ["SSN", "123-45-6789"],
    ["US_ROUTING_NUMBER", "Routing number: 021000021"],
  ])("finds %s with default settings", async (entity, text) => {
    expect(await countFindings(text, settings)).toEqual({ [entity]: 1 });
  });
  test.each([
    ["DATE", "2026-11-16"],
    ["ZIP_CODE", "ZIP: 94105"],
    ["IP_ADDRESS", "192.168.1.42"],
  ])("leaves %s off until selected", async (entity, text) => {
    expect(await countFindings(text, settings)).toEqual({});
    expect(
      await countFindings(text, {
        ...settings,
        entities: [...settings.entities, entity],
      }),
    ).toEqual({ [entity]: 1 });
  });
});

describe("deny list", () => {
  const flagged = { ...settings, denylist: ["Project Atlas"] };
  const plan = "Project Atlas ships; project atlas is late, Atlases aren't";

  test("flags each phrase as a whole word, whatever its case", async () => {
    expect(await countFindings(plan, flagged)).toEqual({ DENYLIST: 2 });
    expect((await redact(plan, flagged)).text).toBe(
      "[DENYLIST] ships; [DENYLIST] is late, Atlases aren't",
    );
  });

  test("flags a phrase even when it's allowed", async () => {
    const allowed = { ...flagged, allowlist: ["Project Atlas"] };

    expect(await countFindings(plan, allowed)).toEqual({ DENYLIST: 2 });
  });

  test("flags phrases with every type turned off", async () => {
    const only = { ...flagged, entities: [] };

    expect(await countFindings(`${plan} ${prompt}`, only)).toEqual({
      DENYLIST: 2,
    });
  });

  test("flags a phrase even when marked not sensitive", async () => {
    const remembered = skipChoices(scanRules, () => [
      { entityType: "DENYLIST", value: "project atlas" },
    ]);

    expect(await countWith(plan, flagged, remembered)).toEqual({
      DENYLIST: 2,
    });
  });

  test("gives the review each phrase with Core's deny detector", async () => {
    const [found] = await workspaceFindings("Project Atlas", flagged);

    expect(found).toMatchObject({
      entityType: "DENYLIST",
      matchedText: "Project Atlas",
      detectorName: "datafog-core/denylist",
    });
  });
});
