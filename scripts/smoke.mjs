/**
 * Headless check of the detection logic, outside the browser.
 *
 * Bundles src/detect.ts for Node and serves the wasm from node_modules in
 * place of the browser's fetch. Usage: node scripts/smoke.mjs
 */

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

await build({
  entryPoints: ["src/detect.ts", "src/settings.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outdir: ".smoke",
  outExtension: { ".js": ".mjs" },
  logLevel: "warning",
});

// Node's fetch can't read files; hand the wasm over directly
const wasm = readFileSync("node_modules/@datafog/wasm/dist/datafog_wasm_bg.wasm");
globalThis.fetch = async () =>
  new Response(wasm, { headers: { "Content-Type": "application/wasm" } });

const { ready, countFindings, redact } = await import("../.smoke/detect.mjs");
const { DEFAULT_ENTITIES } = await import("../.smoke/settings.mjs");
await ready();

const settings = { enabled: true, entities: DEFAULT_ENTITIES, allowlist: [] };
const prompt = "my email is jane@example.com and card 4111 1111 1111 1111";

assert.deepEqual(countFindings(prompt, settings), { EMAIL: 1, CREDIT_CARD: 1 });
assert.equal(redact(prompt, settings), "my email is [EMAIL] and card [CREDIT_CARD]");

// Overlaps count once: a labeled NPI that is also phone-shaped
const npi = "Provider NPI: 2125550100";
assert.deepEqual(countFindings(npi, { ...settings, entities: [...DEFAULT_ENTITIES, "PHONE"] }), { NPI: 1 });

// Opt-in types stay off by default
assert.deepEqual(countFindings("call 415-555-0123", settings), {});
assert.deepEqual(countFindings("call 415-555-0123", { ...settings, entities: ["PHONE"] }), { PHONE: 1 });

// Allowlisted values are not flagged or redacted
const allowed = { ...settings, allowlist: ["jane@example.com"] };
assert.deepEqual(countFindings(prompt, allowed), { CREDIT_CARD: 1 });
assert.equal(redact(prompt, allowed), "my email is jane@example.com and card [CREDIT_CARD]");

// Nothing selected or nothing typed: no work, no errors
assert.deepEqual(countFindings(prompt, { ...settings, entities: [] }), {});
assert.deepEqual(countFindings("   ", settings), {});

console.log("smoke test passed");
