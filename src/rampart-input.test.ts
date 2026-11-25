import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { rampartModelInput } from "./rampart-input";
import { ready, scanRules } from "./detect";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

test("canonical UUIDs cannot become names or addresses in contextual inference", () => {
  expect(rampartModelInput(UUID)).toBe(" ".repeat(UUID.length));
  const text = `😀 José Muñoz: {${UUID.toUpperCase()}}. Contact Nadia.`;
  const input = rampartModelInput(text);
  expect(input.length).toBe(text.length);
  expect(input.indexOf("José Muñoz")).toBe(text.indexOf("José Muñoz"));
  expect(input.indexOf("Nadia")).toBe(text.indexOf("Nadia"));
  expect(input).not.toContain(UUID.toUpperCase());
  expect(input).toContain("{" + " ".repeat(UUID.length) + "}");
});

test("UUID detection remains Core's opt-in decision on the original text", async () => {
  const wasm = readFileSync(
    "node_modules/@datafog/wasm/dist/datafog_wasm_bg.wasm",
  );
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(wasm, { headers: { "Content-Type": "application/wasm" } }),
  );
  try {
    await ready();
  } finally {
    vi.unstubAllGlobals();
  }
  expect(await scanRules(UUID, ["PERSON", "ADDRESS"])).toEqual([]);
  const findings = await scanRules(UUID, ["PERSON", "ADDRESS", "UUID"]);
  expect(findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ entityType: "UUID", matchedText: UUID }),
    ]),
  );
});
