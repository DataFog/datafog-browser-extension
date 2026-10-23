/**
 * Bundle the extension into dist/, ready for "Load unpacked", and the local
 * test page into harness/.
 *
 * Usage: node build.mjs [--watch]
 */

import { context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
const wasm = "node_modules/@datafog/wasm/dist/datafog_wasm_bg.wasm";

/**
 * Empty an output folder and copy in the wasm and static files.
 *
 * @param out The output folder.
 * @param files Static files to copy alongside the bundles.
 */
function prepare(out, files) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(`${out}/dist`, { recursive: true });
  // @datafog/wasm loads ./dist/datafog_wasm_bg.wasm relative to the bundle
  cpSync(wasm, `${out}/dist/datafog_wasm_bg.wasm`);
  for (const file of files) cpSync(file, `${out}/${file}`);
}

prepare("dist", ["manifest.json", "options.html"]);
prepare("harness", ["harness.html"]);

const common = { bundle: true, target: "chrome120", logLevel: "info" };
const builds = await Promise.all([
  // The service worker is a module so import.meta.url works for the wasm path
  context({ ...common, entryPoints: ["src/background.ts"], outfile: "dist/background.js", format: "esm" }),
  context({ ...common, entryPoints: ["src/content.ts"], outfile: "dist/content.js", format: "iife" }),
  context({ ...common, entryPoints: ["src/options.ts"], outfile: "dist/options.js", format: "iife" }),
  context({ ...common, entryPoints: ["src/harness.ts"], outfile: "harness/harness.js", format: "esm" }),
]);

if (watch) {
  await Promise.all(builds.map((build) => build.watch()));
} else {
  await Promise.all(builds.map((build) => build.rebuild()));
  await Promise.all(builds.map((build) => build.dispose()));
}
