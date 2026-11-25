import type { PdfFinding, RedactEdit } from "./messages";

/** Overlap preserves multiline context; only spans starting in a chunk's core belong to it. */
export interface PdfChunk {
  text: string;
  start: number;
  coreStart: number;
  coreEnd: number;
  findings: PdfFinding[];
  policyVersion: string;
}
export function pdfChunks(text: string): PdfChunk[] {
  const chunks: PdfChunk[] = [];
  for (let coreStart = 0; coreStart < text.length; coreStart += 8000) {
    const coreEnd = Math.min(text.length, coreStart + 8000);
    const start = Math.max(0, coreStart - 512);
    chunks.push({
      text: text.slice(start, Math.min(text.length, coreEnd + 512)),
      start,
      coreStart,
      coreEnd,
      findings: [],
      policyVersion: "",
    });
  }
  return chunks;
}
export function owned(chunk: PdfChunk, finding: PdfFinding): boolean {
  const start = chunk.start + finding.start;
  return start >= chunk.coreStart && start < chunk.coreEnd;
}
export function applyPdfEdits(text: string, edits: RedactEdit[]): string {
  const sorted = edits.toSorted((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const edit = sorted[i];
    if (
      edit.start < 0 ||
      edit.end > text.length ||
      edit.end <= edit.start ||
      (i > 0 && sorted[i - 1].end > edit.start)
    )
      throw new Error("pdf_overlapping_findings");
  }
  for (const edit of sorted.toReversed())
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  return text;
}
