/** Local PDF ingestion. Runtime code and OCR models load only after selection. */
export type PdfBox = { x: number; y: number; width: number; height: number };
export type PdfBlock = {
  text: string;
  start: number;
  end: number;
  source: "native" | "ocr";
  box?: PdfBox;
};
export type PdfPage = {
  pageNumber: number;
  text: string;
  blocks: PdfBlock[];
  warnings: string[];
};
export type PdfDocument = { pages: PdfPage[]; warnings: string[] };
export type PdfProgress = {
  pageNumber: number;
  totalPages: number;
  stage: "reading" | "ocr";
};
export type PdfOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: PdfProgress) => void;
};
export async function extractPdf(
  file: File,
  options: PdfOptions = {},
): Promise<PdfDocument> {
  options.signal?.throwIfAborted();
  if (file.size > 50 * 1024 * 1024)
    throw new Error("Choose a PDF smaller than 50 MB.");
  const bytes = await file.arrayBuffer();
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(chrome.runtime.getURL("pdf-runtime.js"), {
      type: "module",
    });
    const clean = () => {
      worker.terminate();
      options.signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      clean();
      reject(
        options.signal?.reason ??
          new DOMException("PDF scan cancelled", "AbortError"),
      );
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.addEventListener("error", () => {
      clean();
      reject(new Error("The local PDF worker failed."));
    });
    worker.addEventListener("message", ({ data }) => {
      if (data.kind === "progress") options.onProgress?.(data.progress);
      else if (data.kind === "result") {
        clean();
        resolve(data.result);
      } else if (data.kind === "error") {
        clean();
        reject(new Error(data.error));
      }
    });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    worker.postMessage(bytes, [bytes]);
  });
}
