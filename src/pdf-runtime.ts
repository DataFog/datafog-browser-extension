import init, {
  LiteParse,
  OcriaNano,
  type ParseSession,
} from "@llamaindex/liteparse-wasm";
import { assemblePage, finishDocument } from "./pdf-layout";
import type { PdfDocument, PdfProgress } from "./pdf";
// This entry point runs only in a dedicated Worker (DOM tsconfig is shared).
declare const self: {
  addEventListener(
    type: "message",
    callback: (event: MessageEvent<ArrayBuffer>) => void,
  ): void;
  postMessage(message: unknown): void;
  location: Location;
};
const send = self.postMessage.bind(self);
const asset = (path: string) => new URL(path, self.location.href).href;
self.addEventListener("message", async ({ data }) => {
  let parser: LiteParse | undefined;
  let model: OcriaNano | undefined;
  let session: ParseSession | undefined;
  try {
    await init({ module_or_path: asset("pdf/liteparse_wasm_bg.wasm") });
    model = await OcriaNano.fromUrl({
      baseUrl: asset("assets/ocria"),
      scripts: ["latin"],
      layout: false,
      verify: true,
    });
    parser = LiteParse.withOcriaNano(
      {
        ocrEnabled: true,
        outputFormat: "json",
        quiet: true,
        maxPages: 100,
        numWorkers: 1,
        dpi: 150,
        continueOnPageError: true,
        emitWordBoxes: true,
        preserveVerySmallText: true,
        keepHeadersFooters: true,
      },
      model,
    );
    session = await parser.openBatchSession(new Uint8Array(data), 1);
    if (session.totalPages > 100)
      throw new Error("Choose a PDF with 100 pages or fewer.");
    const result: PdfDocument = { pages: [], warnings: [] };
    for (let pageNumber = 1; pageNumber <= session.totalPages; pageNumber++) {
      const progress: PdfProgress = {
        pageNumber,
        totalPages: session.totalPages,
        stage: "reading",
      };
      send({ kind: "progress", progress });
      const batch = await session.nextBatch();
      if (!batch) break;
      for (const page of batch.result.pages) {
        const warnings: string[] = [];
        if (batch.result.imageErrorCount > 0)
          warnings.push(
            `${batch.result.imageErrorCount} image region(s) could not be extracted; source content may be missing.`,
          );
        if (!page.text.trim())
          warnings.push(
            "No readable text found; this page may be blank or unreadable.",
          );
        if (
          page.textItems.some(
            (item) => item.confidence !== undefined && item.confidence < 0.65,
          )
        )
          warnings.push(
            "Low-confidence OCR: compare this page with the original.",
          );
        const items = page.textItems.map((item) => ({
          text: item.text,
          source:
            item.confidence === undefined
              ? ("native" as const)
              : ("ocr" as const),
          box: { x: item.x, y: item.y, width: item.width, height: item.height },
        }));
        // LiteParse already merges native and OCR regions. Keep all final items.
        result.pages.push(
          assemblePage(page.pageNum, page.text, items, warnings),
        );
      }
      for (const error of batch.result.pageErrors ?? [])
        result.pages.push({
          pageNumber: error.pageNum,
          text: "",
          blocks: [],
          warnings: [`Page could not be extracted: ${error.message}`],
        });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    send({
      kind: "result",
      result: finishDocument(result.pages, session.totalPages),
    });
  } catch (error) {
    send({
      kind: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    session?.free();
    parser?.free();
    model?.free();
  }
});
