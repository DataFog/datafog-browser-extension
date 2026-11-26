/** Offline, pinned Rampart bundle. Called by build.mjs for each extension output. */
import { build } from "esbuild";
import { cp, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
export async function buildRampart(out) {
  const manifest = JSON.parse(
    await readFile("assets/rampart/manifest.json", "utf8"),
  );
  for (const [name, expected] of Object.entries(manifest.sha256)) {
    const actual = createHash("sha256")
      .update(await readFile(`assets/rampart/model/${name}`))
      .digest("hex");
    if (actual !== expected)
      throw new Error(`Rampart asset checksum mismatch: ${name}`);
  }
  await mkdir(`${out}/rampart`, { recursive: true });
  await cp("assets/rampart/model", `${out}/rampart/model`, { recursive: true });
  await build({
    entryPoints: ["src/rampart-worker.ts"],
    outfile: `${out}/rampart/worker.js`,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  // Match the exact ORT version resolved by transformers, never Core's runtime.
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const transformersRequire = createRequire(
    require.resolve("@huggingface/transformers"),
  );
  const runtime = transformersRequire.resolve("onnxruntime-web");
  const { dirname, join } = await import("node:path");
  // Copy the runtime files the bundled worker loads. Their names change
  // between ONNX Runtime releases, so read them from the bundle.
  const worker = await readFile(`${out}/rampart/worker.js`, "utf8");
  const names = new Set(worker.match(/ort-wasm[\w.-]*\.(?:mjs|wasm)/g));
  if (!names.size)
    throw new Error("Rampart worker references no ONNX Runtime files");
  for (const name of names) {
    const source = join(dirname(runtime), name);
    if (!existsSync(source))
      throw new Error(`Rampart worker needs a missing runtime file: ${name}`);
    await cp(source, `${out}/rampart/${name}`);
  }
}
