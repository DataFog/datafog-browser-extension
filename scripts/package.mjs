/**
 * Zip the built extension in dist/ for the Chrome Web Store, as
 * release/datafog-<version>.zip. Run `npm run build` first; `npm run package`
 * does both. Needs the `zip` command, as on macOS and Linux.
 *
 * Usage: node scripts/package.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const { version } = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
const out = path.resolve("release", `datafog-${version}.zip`);

mkdirSync("release", { recursive: true });
rmSync(out, { force: true });
// From inside dist/, so manifest.json sits at the zip's root as the store
// requires; -X leaves out file owners and other extra attributes
execFileSync("zip", ["-r", "-X", "-q", out, "."], {
  cwd: "dist",
  stdio: "inherit",
});
if (!existsSync(out)) throw new Error(`Packaging didn't create ${out}.`);
console.log(`Packaged ${path.relative(process.cwd(), out)}`);
