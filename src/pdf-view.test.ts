// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import {
  renderPdfView,
  validViewFindings,
  type PdfViewerSnapshot,
} from "./pdf-view";
import { isViewerCommand } from "./pdf-viewer-client";
const state = (): PdfViewerSnapshot => ({
  fileName: "example.pdf",
  pages: [
    {
      pageNumber: 1,
      text: "Email jane@example.com. Again jane@example.com.",
      warnings: [],
      findings: [
        {
          id: "first",
          start: 6,
          end: 22,
          original: "jane@example.com",
          entityType: "EMAIL",
          action: "replace",
          replacement: "[[EMAIL_TEST]]",
        },
        {
          id: "second",
          start: 30,
          end: 46,
          original: "jane@example.com",
          entityType: "EMAIL",
          action: "keep",
        },
      ],
    },
  ],
  pageIndex: 0,
  working: false,
  status: "Ready",
});
describe("PDF shared document rendering", () => {
  it("preserves complete original text and distinct repeated findings", () => {
    const container = document.createElement("article");
    renderPdfView(container, state(), () => {});
    expect(container.textContent).toBe(state().pages[0].text);
    expect(container.querySelectorAll(".pdf-inline-value")).toHaveLength(2);
  });
  it("shows reserved replacements as sent while retaining kept occurrences", () => {
    const container = document.createElement("article");
    renderPdfView(container, { ...state(), mode: "as-sent" }, () => {});
    expect(container.textContent).toBe(
      "Email [[EMAIL_TEST]]. Again jane@example.com.",
    );
  });
  it("anchors per-occurrence controls and dispatches exact action IDs", () => {
    const container = document.createElement("article");
    const command = vi.fn();
    renderPdfView(container, { ...state(), selectedId: "second" }, command);
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".pdf-inline-controls button",
    );
    buttons[0].click();
    buttons[1].click();
    expect(command.mock.calls).toEqual([
      [{ type: "action", id: "second", action: "replace" }],
      [{ type: "action", id: "second", action: "redact" }],
    ]);
  });
  it("never interprets document text as HTML", () => {
    const container = document.createElement("article");
    const snapshot = state();
    snapshot.pages[0] = {
      pageNumber: 1,
      text: "<script>alert(1)</script>",
      warnings: [],
      findings: [],
    };
    renderPdfView(container, snapshot, () => {});
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toBe("<script>alert(1)</script>");
  });
  it("omits invalid or overlapping findings without dropping original content", () => {
    const snapshot = state();
    snapshot.pages[0].findings[1].start = 7;
    expect(validViewFindings(snapshot.pages[0])).toHaveLength(1);
  });
  it("rejects malformed viewer commands", () => {
    expect(
      isViewerCommand({ type: "action", id: "first", action: "send" }),
    ).toBe(false);
    expect(isViewerCommand({ type: "page", pageIndex: 1.5 })).toBe(false);
    expect(
      isViewerCommand({ type: "action", id: "first", action: "redact" }),
    ).toBe(true);
  });
});
