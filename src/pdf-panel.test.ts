// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PdfPreviewChunk, PdfPreviewResponse } from "./messages";
const extraction = vi.hoisted(() => vi.fn());
const viewerCopy = vi.hoisted(() => vi.fn());
const viewerOpen = vi.hoisted(() => vi.fn());
const viewerReject = vi.hoisted(() => vi.fn());
vi.mock("./pdf", () => ({ extractPdf: extraction }));
vi.mock("./pdf-viewer-client", () => ({
  closePdfViewer: vi.fn(),
  updatePdfViewer: vi.fn(),
  openPdfViewer: viewerOpen,
  copyPdfViewerText: viewerCopy,
  rejectPdfViewerCopy: viewerReject,
}));
const BODY = readFileSync("panel.html", "utf8")
  .split("<body>")[1]
  .split("<script")[0];
const original = "jane@example.org";
let send: ReturnType<typeof vi.fn>;
let exact: PdfPreviewResponse;
const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const get = (id: string) => document.getElementById(id)!;
beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = BODY;
  extraction.mockResolvedValue({
    pages: [
      { pageNumber: 1, text: `Hello ${original}.`, blocks: [], warnings: [] },
    ],
    warnings: [],
  });
  viewerCopy.mockReset().mockResolvedValue(undefined);
  viewerReject.mockReset();
  viewerOpen.mockReset().mockResolvedValue(undefined);
  let previewCount = 0;
  send = vi.fn(async (request) => {
    if (request.type === "pdf-target")
      return {
        tabId: 7,
        url: "https://chatgpt.com/c/1",
        text: "My draft",
        revision: 1,
        documentId: "doc",
      };
    if (request.type === "pdf-scan")
      return {
        policyVersion: "p1",
        findings: [
          {
            start: 6,
            end: 22,
            entityType: "EMAIL",
            original,
            action: "replace",
          },
        ],
      };
    if (request.type === "pdf-preview") {
      exact = {
        previewId: String(++previewCount),
        policyVersion: "p1",
        chunks: request.chunks.map((chunk: PdfPreviewChunk) => {
          const finding = chunk.findings[0];
          const replacement =
            finding.action === "redact" ? "[EMAIL]" : "[[EMAIL_A]]";
          return {
            id: chunk.id,
            text:
              finding.action === "keep" ? chunk.text : `Hello ${replacement}.`,
            edits:
              finding.action === "keep"
                ? []
                : [{ start: 6, end: 22, replacement }],
          };
        }),
      };
      return exact;
    }
    if (request.type === "pdf-apply") return { ...exact, saved: true };
    return {};
  });
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: send },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    windows: { getCurrent: async () => ({ id: 1 }) },
  });
  await import("./pdf-panel");
  await tick();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function load(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#pdf-file")!;
  Object.defineProperty(input, "files", {
    value: [new File(["%PDF"], "contract.pdf", { type: "application/pdf" })],
  });
  input.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(
      document.querySelector<HTMLButtonElement>("#pdf-insert")!.disabled,
    ).toBe(false),
  );
}
test("docked review toggles exact output, changes an occurrence, and inserts only the committed preview", async () => {
  await load();
  expect(get("pdf-tools").dataset.state).toBe("review");
  expect(get("pdf-file-name").textContent).toBe("contract.pdf");
  expect(get("pdf-preview").textContent).toBe(`Hello ${original}.`);
  get("pdf-as-sent").click();
  expect(get("pdf-preview").textContent).toBe("Hello [[EMAIL_A]].");
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "pdf-insert" }),
  );
  document.querySelector<HTMLButtonElement>(".pdf-inline-value")!.click();
  const mask = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".pdf-value-controls button"),
  ).find((button) => button.textContent === "Mask")!;
  mask.click();
  await vi.waitFor(() =>
    expect(get("pdf-preview").textContent).toContain("[EMAIL]"),
  );
  await vi.waitFor(() =>
    expect(
      document.querySelector<HTMLButtonElement>("#pdf-insert")!.disabled,
    ).toBe(false),
  );
  get("pdf-insert").click();
  await vi.waitFor(() =>
    expect(get("pdf-tools").dataset.state).toBe("inserted"),
  );
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ type: "pdf-apply", previewId: exact.previewId }),
  );
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ type: "pdf-insert", text: "Hello [EMAIL]." }),
  );
});
test("removing a file releases its exact reservation and clears raw document text", async () => {
  await load();
  const previewId = exact.previewId;
  get("pdf-cancel").click();
  await tick();
  expect(get("pdf-tools").dataset.state).toBe("empty");
  expect(get("pdf-preview").textContent).toBe("");
  expect(send).toHaveBeenCalledWith({ type: "pdf-preview-cancel", previewId });
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "pdf-apply" }),
  );
});

test("larger-view Copy delivers only committed approved text to the viewer and supports retry", async () => {
  await load();
  const sideClipboard = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue(undefined);
  get("pdf-larger").click();
  const onCommand = viewerOpen.mock.calls[0][1];
  viewerCopy.mockRejectedValueOnce(new Error("clipboard_denied"));
  onCommand({ type: "copy" });
  await vi.waitFor(() =>
    expect(get("pdf-status").textContent).toContain("Could not copy"),
  );
  expect(viewerCopy).toHaveBeenCalledWith("Hello [[EMAIL_A]].");
  expect(sideClipboard).not.toHaveBeenCalled();
  expect(
    send.mock.calls.filter(([request]) => request.type === "pdf-apply"),
  ).toHaveLength(1);
  onCommand({ type: "copy" });
  await vi.waitFor(() =>
    expect(get("pdf-status").textContent).toContain("Copied as sent"),
  );
  expect(
    send.mock.calls.filter(([request]) => request.type === "pdf-apply"),
  ).toHaveLength(1);
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "pdf-insert" }),
  );
});

test("larger-view Copy rejects pending clipboard data when saving fails", async () => {
  await load();
  get("pdf-larger").click();
  const onCommand = viewerOpen.mock.calls[0][1];
  send
    .mockImplementationOnce(async () => ({}))
    .mockImplementationOnce(async () => ({ error: "vault_write_failed" }));
  onCommand({ type: "copy" });
  await vi.waitFor(() => expect(viewerReject).toHaveBeenCalled());
  expect(viewerCopy).not.toHaveBeenCalled();
  expect(get("pdf-status").textContent).toContain("vault_write_failed");
});

test("new users can drop a PDF without accepting terms", async () => {
  expect(document.querySelector<HTMLInputElement>("#pdf-file")!.disabled).toBe(
    false,
  );
  const event = new DragEvent("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [new File(["%PDF"], "dropped.pdf", { type: "application/pdf" })],
    },
  });
  get("pdf-drop").dispatchEvent(event);
  await vi.waitFor(() =>
    expect(
      document.querySelector<HTMLButtonElement>("#pdf-insert")!.disabled,
    ).toBe(false),
  );
  expect(get("pdf-file-name").textContent).toBe("dropped.pdf");
  expect(extraction).toHaveBeenCalled();
});
