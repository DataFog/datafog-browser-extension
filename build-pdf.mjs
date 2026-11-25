import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const pins = {
  "det.onnx":
    "70ea641d74c4d7d3acb734002cc1507350d8350ad44aeedc6f8ac6017dbcff7a",
  "det.meta.json":
    "ada6b3c5de0800eb43fa81dbec714d47cd2a712a22952ef23cf38c805b27350e",
  "router.onnx":
    "daccb2e3ce3891b7cb95037ada3861e05fd288d7678d2a1e662d9483e04dd361",
  "rec_latin.onnx":
    "7ac8f6815b4b127f244c14f86c51f65224c82e022c1ee71f867f2be955be4da4",
  "rec_latin.charset.json":
    "d386eea5691a4f3d9e40f48a3979cf859caf626c3ec43214c7911a713e1f4ed0",
};
/** Asset hashes match LiteParse 2.21.1's OCRia 1.0.0 release pins. */
export async function buildPdf(out) {
  for (const [name, hash] of Object.entries(pins))
    if (
      createHash("sha256")
        .update(readFileSync(`assets/ocria/${name}`))
        .digest("hex") !== hash
    )
      throw new Error(`OCRia asset hash mismatch: ${name}`);
  mkdirSync(`${out}/pdf`, { recursive: true });
  cpSync(
    "node_modules/@llamaindex/liteparse-wasm/pkg/liteparse_wasm_bg.wasm",
    `${out}/pdf/liteparse_wasm_bg.wasm`,
  );
  cpSync("licenses/liteparse/LICENSE", `${out}/pdf/LITEPARSE-LICENSE.txt`);
  cpSync("PDF_NOTICES.md", `${out}/PDF_NOTICES.md`);
  cpSync("assets/ocria", `${out}/assets/ocria`, { recursive: true });
  await build({
    entryPoints: ["src/pdf-runtime.ts"],
    outfile: `${out}/pdf-runtime.js`,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    logLevel: "info",
  });
}
