import { expect, test } from "vitest";
import { applyPdfEdits, owned, pdfChunks } from "./pdf-review";

test("overlapping chunks own each exact original span once without dropping source text", () => {
  const text =
    "A".repeat(7995) + "Zoë Smith\n12 Maple Street\nUnit 4" + "B".repeat(8500);
  const chunks = pdfChunks(text);
  expect(chunks.every((chunk) => chunk.text.length <= 9024)).toBe(true);
  const start = 7995;
  const end = start + "Zoë Smith\n12 Maple Street\nUnit 4".length;
  const matches = chunks
    .filter(
      (chunk) => chunk.start <= start && chunk.start + chunk.text.length >= end,
    )
    .map((chunk) => ({
      chunk,
      finding: {
        start: start - chunk.start,
        end: end - chunk.start,
        entityType: "ADDRESS",
        original: text.slice(start, end),
        action: "redact" as const,
      },
    }));
  expect(matches).toHaveLength(2);
  expect(
    matches.filter(({ chunk, finding }) => owned(chunk, finding)),
  ).toHaveLength(1);
  expect(applyPdfEdits(text, [{ start, end, replacement: "[ADDRESS]" }])).toBe(
    "A".repeat(7995) + "[ADDRESS]" + "B".repeat(8500),
  );
});

test("conflicting spans fail instead of partially exposing or corrupting approved output", () => {
  expect(() =>
    applyPdfEdits("123 Main St", [
      { start: 0, end: 8, replacement: "x" },
      { start: 4, end: 11, replacement: "y" },
    ]),
  ).toThrow("pdf_overlapping_findings");
});
