import { describe, it, expect } from "vitest";
import {
  assemblePage,
  finishDocument,
  type PositionedText,
} from "./pdf-layout";
const item = (text: string, x = 10, y = 10): PositionedText => ({
  text,
  source: "native",
  box: { x, y, width: 100, height: 12 },
});
describe("canonical PDF text and geometry", () => {
  it("preserves parser whitespace and reading order even when boxes disagree", () => {
    const text = "Zoë García\n\n123 Main Street\nUnit 4";
    const page = assemblePage(2, text, [
      item("Zoë García", 200, 200),
      item("123 Main Street", 10, 10),
      item("Unit 4", 10, 40),
    ]);
    expect(page.text).toBe(text);
    expect(page.pageNumber).toBe(2);
    for (const block of page.blocks)
      expect(page.text.slice(block.start, block.end)).toBe(block.text);
  });
  it("does not insert spaces into an email split into adjacent PDF runs", () => {
    const page = assemblePage(1, "jane@example.com", [
      item("jane", 10),
      item("@", 30),
      item("example.com", 40),
    ]);
    expect(page.text).toBe("jane@example.com");
    expect(page.blocks.map((b) => [b.start, b.end])).toEqual([
      [0, 4],
      [4, 5],
      [5, 16],
    ]);
  });
  it("maps duplicate values to distinct original occurrences", () => {
    const page = assemblePage(1, "Jane Smith\nJane Smith", [
      item("Jane Smith"),
      item("Jane Smith", 10, 40),
    ]);
    expect(page.blocks.map((b) => b.start)).toEqual([0, 11]);
    expect(page.text).toBe("Jane Smith\nJane Smith");
  });
  it("retains canonical content even when item text cannot be mapped", () => {
    const page = assemblePage(1, "123 Main Street\nUnit 4", [
      item("123  Main Street"),
      item("Unit 4"),
    ]);
    expect(page.text).toBe("123 Main Street\nUnit 4");
    expect(page.blocks).toHaveLength(1);
    expect(page.blocks[0].start).toBe(16);
  });
  it("reports missing and partial pages in document-level warnings without duplicating text", () => {
    const result = finishDocument(
      [
        assemblePage(1, "Known content", [item("Known content")]),
        assemblePage(1, "", [], ["An image region could not be read."]),
      ],
      2,
    );
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].text).toBe("Known content");
    expect(result.warnings).toEqual([
      "Page 1: An image region could not be read.",
      "Page 2: Page was not returned by the parser; extraction is incomplete.",
    ]);
  });
});
