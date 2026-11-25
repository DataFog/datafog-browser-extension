import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import init, { LiteParse, OcriaNano } from "@llamaindex/liteparse-wasm";
let model, parser;
const f = (name) => new Uint8Array(readFileSync(`assets/ocria/${name}`));
beforeAll(async () => {
  await init({
    module_or_path: readFileSync(
      "node_modules/@llamaindex/liteparse-wasm/pkg/liteparse_wasm_bg.wasm",
    ),
  });
  model = OcriaNano.load({
    det: f("det.onnx"),
    detMeta: f("det.meta.json"),
    router: f("router.onnx"),
    recLatin: {
      onnx: f("rec_latin.onnx"),
      charset: f("rec_latin.charset.json"),
    },
  });
  parser = LiteParse.withOcriaNano(
    {
      ocrEnabled: true,
      quiet: true,
      emitWordBoxes: true,
      continueOnPageError: true,
    },
    model,
  );
});
afterAll(() => {
  parser?.free();
  model?.free();
});
describe("pinned LiteParse/OCRia fixtures", () => {
  for (const kind of ["native", "scanned", "mixed"])
    it(`extracts every gold value once from ${kind}`, async () => {
      const session = await parser.openBatchSession(
        new Uint8Array(readFileSync(`e2e/pdf-fixtures/${kind}.pdf`)),
        1,
      );
      try {
        expect(session.totalPages).toBe(1);
        const batch = await session.nextBatch();
        const page = batch.result.pages[0];
        expect(page.pageNum).toBe(1);
        for (const value of [
          "Jane",
          "Zoë García",
          "jane@example.com",
          "123 Main Street",
          "Unit 4",
          "Springfield, IL 62704",
        ])
          expect(page.text.split(value).length - 1, value).toBe(1);
        expect(
          page.textItems.every((item) => item.width > 0 && item.height > 0),
        ).toBe(true);
        if (kind === "mixed") {
          expect(page.textItems.some((item) => item.fontName === "OCR")).toBe(
            true,
          );
          expect(page.textItems.some((item) => item.fontName !== "OCR")).toBe(
            true,
          );
        }
        expect(await session.nextBatch()).toBeUndefined();
      } finally {
        session.free();
      }
    });
  for (const kind of ["corrupt", "encrypted"])
    it(`rejects ${kind} PDF`, async () => {
      await expect(
        parser.parse(
          new Uint8Array(readFileSync(`e2e/pdf-fixtures/${kind}.pdf`)),
        ),
      ).rejects.toThrow();
    });
});
