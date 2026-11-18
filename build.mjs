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
// FogVault runs in its own module Worker, loaded from these files unbundled
const fogvault = "node_modules/@datafog/fogvault-browser/dist";
// So does Core's name and address model; its Worker imports Core beside it
const core = "node_modules/@datafog/wasm";
const coreFiles = ["index.js", "dist", "cnn"];

/**
 * Empty an output folder and copy in the wasm and static files.
 *
 * @param out The output folder.
 * @param files Static files and folders to copy alongside the bundles.
 */
function prepare(out, files) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(`${out}/dist`, { recursive: true });
  // @datafog/wasm loads ./dist/datafog_wasm_bg.wasm relative to the bundle
  cpSync(wasm, `${out}/dist/datafog_wasm_bg.wasm`);
  for (const file of files) cpSync(file, `${out}/${file}`, { recursive: true });
}

prepare("dist", [
  "icons",
  "manifest.json",
  "offscreen.html",
  "options.html",
  "panel.html",
  "theme.css",
]);
// Its licenses, under third-party/, ship with it
cpSync(fogvault, "dist/fogvault", { recursive: true });
for (const file of coreFiles) {
  cpSync(`${core}/${file}`, `dist/datafog/wasm/${file}`, {
    recursive: true,
    // Types aren't needed at run time
    filter: (source) => !source.endsWith(".d.ts"),
  });
}
prepare("harness", ["harness.html"]);

const common = { bundle: true, target: "chrome120", logLevel: "info" };
const builds = await Promise.all([
  // The service worker is a module so import.meta.url works for the wasm path
  context({
    ...common,
    entryPoints: ["src/background.ts"],
    outfile: "dist/background.js",
    format: "esm",
  }),
  context({
    ...common,
    entryPoints: ["src/offscreen.ts"],
    outfile: "dist/offscreen.js",
    format: "esm",
  }),
  context({
    ...common,
    entryPoints: ["src/content.ts"],
    outfile: "dist/content.js",
    format: "iife",
  }),
  context({
    ...common,
    entryPoints: ["src/options.ts"],
    outfile: "dist/options.js",
    format: "iife",
  }),
  context({
    ...common,
    entryPoints: ["src/panel.ts"],
    outfile: "dist/panel.js",
    format: "iife",
  }),
  context({
    ...common,
    entryPoints: ["src/harness.ts"],
    outfile: "harness/harness.js",
    format: "esm",
  }),
]);

if (watch) {
  await Promise.all(builds.map((build) => build.watch()));
} else {
  await Promise.all(builds.map((build) => build.rebuild()));
  await Promise.all(builds.map((build) => build.dispose()));
}
