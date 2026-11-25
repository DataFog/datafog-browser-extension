import type { PdfBlock, PdfBox, PdfDocument, PdfPage } from "./pdf";
export type PositionedText = {
  text: string;
  source: "native" | "ocr";
  box: PdfBox;
};
/** Preserve the parser's canonical reading order and whitespace verbatim.
 * Geometry is optional: only attach boxes to verified, non-overlapping spans.
 * Unmappable items are omitted from the geometry index, never from page text.
 */
export function assemblePage(
  pageNumber: number,
  text: string,
  items: PositionedText[],
  warnings: string[] = [],
): PdfPage {
  const blocks: PdfBlock[] = [];
  let cursor = 0;
  for (const item of items) {
    if (!item.text) continue;
    const start = text.indexOf(item.text, cursor);
    if (start < 0) continue;
    const end = start + item.text.length;
    blocks.push({ ...item, start, end });
    cursor = end;
  }
  return { pageNumber, text, blocks, warnings };
}
/** Make every incomplete page visible before insertion, even when not selected. */
export function finishDocument(
  pages: PdfPage[],
  totalPages: number,
): PdfDocument {
  const complete: PdfPage[] = [];
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    const entries = pages.filter((page) => page.pageNumber === pageNumber);
    const page = entries.find((entry) => entry.text) ??
      entries[0] ?? {
        pageNumber,
        text: "",
        blocks: [],
        warnings: [
          "Page was not returned by the parser; extraction is incomplete.",
        ],
      };
    complete.push({
      ...page,
      warnings: [
        ...new Set(
          entries.length
            ? entries.flatMap((entry) => entry.warnings)
            : page.warnings,
        ),
      ],
    });
  }
  return {
    pages: complete,
    warnings: complete.flatMap((page) =>
      page.warnings.map((warning) => `Page ${page.pageNumber}: ${warning}`),
    ),
  };
}
