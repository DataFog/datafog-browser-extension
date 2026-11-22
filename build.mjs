/**
 * Bundle the extension into dist/, ready for "Load unpacked", and the local
 * test page into harness/.
 *
 * Usage: node build.mjs [--watch]
 */

import { context } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
const outputFlag = process.argv.indexOf("--output-root");
const outputRoot = outputFlag < 0 ? "." : process.argv[outputFlag + 1];
if (!outputRoot || outputRoot.startsWith("--"))
  throw new Error("--output-root needs a directory");
const output = (name) => `${outputRoot}/${name}`;
const wasm = "node_modules/@datafog/wasm/dist/datafog_wasm_bg.wasm";
// FogVault runs in its own module Worker, loaded from these files unbundled
const fogvault = "node_modules/@datafog/fogvault-browser/dist";
// So does Core's name and address model; its Worker imports Core beside it
const core = "node_modules/@datafog/wasm";
const coreFiles = ["index.js", "dist", "cnn"];

/**
 * Update output files without removing a possibly installed extension directory.
 *
 * @param out The output folder.
 * @param files Static files and folders to copy alongside the bundles.
 */
function prepare(out, files) {
  mkdirSync(`${out}/dist`, { recursive: true });
  // @datafog/wasm loads ./dist/datafog_wasm_bg.wasm relative to the bundle
  cpSync(wasm, `${out}/dist/datafog_wasm_bg.wasm`);
  for (const file of files) cpSync(file, `${out}/${file}`, { recursive: true });
}

// The extension's license ships with it; it also covers Core's own code
prepare(output("dist"), [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "licenses",
  "fonts",
  "icons",
  "manifest.json",
  "offscreen.html",
  "options.html",
  "panel.html",
  "theme.css",
  "welcome.html",
]);
// Its licenses, under third-party/, ship with it
cpSync(fogvault, output("dist/fogvault"), { recursive: true });
for (const file of coreFiles) {
  cpSync(`${core}/${file}`, output(`dist/datafog/wasm/${file}`), {
    recursive: true,
    // Types aren't needed at run time
    filter: (source) => !source.endsWith(".d.ts"),
  });
}
prepare(output("harness"), ["harness.html"]);

const common = { bundle: true, target: "chrome120", logLevel: "info" };
const builds = await Promise.all([
  // The service worker is a module so import.meta.url works for the wasm path
  context({
    ...common,
    entryPoints: ["src/background.ts"],
    outfile: output("dist/background.js"),
    format: "esm",
  }),
  context({
    ...common,
    entryPoints: ["src/offscreen.ts"],
    outfile: output("dist/offscreen.js"),
    format: "esm",
  }),
  context({
    ...common,
    entryPoints: ["src/content.ts"],
    outfile: output("dist/content.js"),
    format: "iife",
  }),
  context({
    ...common,
    entryPoints: ["src/options.ts"],
    outfile: output("dist/options.js"),
    format: "iife",
  }),
  context({
    ...common,
    entryPoints: ["src/panel.ts"],
    outfile: output("dist/panel.js"),
    format: "iife",
  }),
  context({
    ...common,
    entryPoints: ["src/welcome.ts"],
    outfile: output("dist/welcome.js"),
    format: "iife",
  }),
  context({
    ...common,
    entryPoints: ["src/harness.ts"],
    outfile: output("harness/harness.js"),
    format: "esm",
  }),
]);

if (watch) {
  await Promise.all(builds.map((build) => build.watch()));
} else {
  await Promise.all(builds.map((build) => build.rebuild()));
  await Promise.all(builds.map((build) => build.dispose()));
}
