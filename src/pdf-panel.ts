/** File contents and review state live only in extension-owned documents. */
import { extractPdf, type PdfPage } from "./pdf";
import type {
  PdfDraft,
  PdfFinding,
  PdfRequest,
  PdfPreviewChunk,
  PdfPreviewResponse,
} from "./messages";
import { owned, pdfChunks, type PdfChunk } from "./pdf-review";
import {
  renderPdfView,
  type PdfViewerSnapshot,
  type PdfViewerCommand,
  type PdfViewMode,
} from "./pdf-view";
import {
  closePdfViewer,
  copyPdfViewerText,
  rejectPdfViewerCopy,
  openPdfViewer,
  updatePdfViewer,
} from "./pdf-viewer-client";

const el = (id: string) => document.getElementById(id)!;
const picker = document.querySelector<HTMLInputElement>("#pdf-file")!;
const insert = document.querySelector<HTMLButtonElement>("#pdf-insert")!;
const copy = document.querySelector<HTMLButtonElement>("#pdf-copy")!;
const cancel = document.querySelector<HTMLButtonElement>("#pdf-cancel")!;
const pageSelect = document.querySelector<HTMLSelectElement>("#pdf-page")!;
const progress = document.querySelector<HTMLProgressElement>("#pdf-progress")!;
let generation = 0;
let previewRevision = 0;
let abort: AbortController | undefined;
let draft: PdfDraft | undefined;
let originWindow = 0;
let fileName = "";
let pages: { page: PdfPage; chunks: PdfChunk[] }[] = [];
let finalChunks: (PdfPreviewChunk & { pageIndex: number; start: number })[] =
  [];
let preview: PdfPreviewResponse | undefined;
let committed = false;
let working = false;
let previewPending = false;
let finalizing = false;
let mode: PdfViewMode = "original";
let selectedId: string | undefined;
let phase: "empty" | "reading" | "review" | "inserted" = "empty";

async function ask<T>(request: PdfRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage(request);
  if (!response || response.error)
    throw new Error(response?.error ?? "no_response");
  return response;
}
function status(text: string): void {
  el("pdf-status").textContent = text;
}
function setPhase(next: typeof phase): void {
  phase = next;
  el("pdf-tools").dataset.state = next;
  el("pdf-empty").hidden = next !== "empty";
  el("pdf-file-card").hidden = next === "empty" || next === "inserted";
  el("pdf-reading").hidden = next !== "reading";
  el("pdf-review").hidden = next !== "review";
  el("pdf-inserted").hidden = next !== "inserted";
}
function pickerState(): void {
  picker.disabled = working;
  el("pdf-drop").setAttribute("aria-disabled", String(working));
}
function releasePreview(): void {
  if (preview && !committed)
    void ask({
      type: "pdf-preview-cancel",
      previewId: preview.previewId,
    }).catch(() => {});
  preview = undefined;
  committed = false;
}
function clear(): void {
  generation++;
  previewRevision++;
  abort?.abort();
  abort = undefined;
  releasePreview();
  closePdfViewer();
  draft = undefined;
  pages = [];
  finalChunks = [];
  fileName = "";
  picker.value = "";
  pageSelect.replaceChildren();
  el("pdf-preview").replaceChildren();
  el("pdf-findings").replaceChildren();
  insert.disabled = true;
  copy.disabled = true;
  cancel.disabled = true;
  working = false;
  previewPending = false;
  finalizing = false;
  mode = "original";
  selectedId = undefined;
  pickerState();
  setPhase("empty");
}
function findingId(
  pageIndex: number,
  chunk: PdfChunk,
  finding: PdfFinding,
): string {
  return `${pageIndex}:${chunk.start + finding.start}:${chunk.start + finding.end}`;
}
function snapshot(): PdfViewerSnapshot {
  return {
    fileName,
    pageIndex: Number(pageSelect.value || 0),
    working: working || previewPending,
    mode,
    selectedId,
    status: el("pdf-status").textContent ?? "",
    pages: pages.map((entry, pageIndex) => ({
      pageNumber: entry.page.pageNumber,
      text: entry.page.text,
      warnings: entry.page.warnings,
      findings: entry.chunks.flatMap((chunk) =>
        chunk.findings
          .filter((finding) => owned(chunk, finding))
          .map((finding) => {
            const start = chunk.start + finding.start;
            const end = chunk.start + finding.end;
            const outputChunk = finalChunks.find(
              (item) =>
                item.pageIndex === pageIndex &&
                start >= item.start &&
                end <= item.start + item.text.length,
            );
            const edit =
              outputChunk &&
              preview?.chunks
                .find((item) => item.id === outputChunk.id)
                ?.edits.find(
                  (item) =>
                    item.start + outputChunk.start === start &&
                    item.end + outputChunk.start === end,
                );
            return {
              ...finding,
              id: findingId(pageIndex, chunk, finding),
              start,
              end,
              replacement: edit?.replacement,
            };
          }),
      ),
    })),
  };
}
function render(): void {
  if (phase !== "review") return;
  const state = snapshot();
  renderPdfView(el("pdf-preview"), state, command);
  updatePdfViewer(state);
  el("pdf-original").setAttribute("aria-pressed", String(mode === "original"));
  el("pdf-as-sent").setAttribute("aria-pressed", String(mode === "as-sent"));
  const count = state.pages.reduce(
    (sum, page) => sum + page.findings.length,
    0,
  );
  el("pdf-finding-count").textContent = String(count);
  el("pdf-finding-count").hidden = false;
  el("pdf-page-warning").textContent =
    state.pages[state.pageIndex]?.warnings.join(" ") ?? "";
  insert.disabled = working || previewPending || !preview;
  copy.disabled = insert.disabled;
  pageSelect.disabled = working;
  cancel.disabled = finalizing;
}
/** Final chunks are disjoint, and no boundary cuts a reviewed occurrence. */
function prepareChunks(): typeof finalChunks {
  const result: typeof finalChunks = [];
  for (const [pageIndex, entry] of pages.entries()) {
    const findings = entry.chunks
      .flatMap((chunk) =>
        chunk.findings
          .filter((f) => owned(chunk, f))
          .map((f) => ({
            ...f,
            start: f.start + chunk.start,
            end: f.end + chunk.start,
          })),
      )
      .toSorted((a, b) => a.start - b.start);
    if (findings.some((f, i) => i > 0 && findings[i - 1].end > f.start))
      throw new Error("pdf_overlapping_findings");
    for (let start = 0; start < entry.page.text.length;) {
      let end = Math.min(entry.page.text.length, start + 8000);
      const crossed = findings.find((f) => f.start < end && f.end > end);
      if (crossed) end = crossed.start > start ? crossed.start : crossed.end;
      result.push({
        id: `p${pageIndex}:${start}`,
        pageIndex,
        start,
        text: entry.page.text.slice(start, end),
        policyVersion: entry.chunks[0].policyVersion,
        findings: findings
          .filter((f) => f.start >= start && f.end <= end)
          .map((f) => ({ ...f, start: f.start - start, end: f.end - start })),
      });
      start = end;
    }
  }
  return result;
}
async function refreshPreview(): Promise<void> {
  if (!draft || working) return;
  const mine = generation;
  const revision = ++previewRevision;
  releasePreview();
  previewPending = true;
  status("Preparing exact preview…");
  render();
  try {
    const chunks = prepareChunks();
    const response = await ask<PdfPreviewResponse>({
      type: "pdf-preview",
      draft,
      chunks,
    });
    if (mine !== generation || revision !== previewRevision) {
      void ask({
        type: "pdf-preview-cancel",
        previewId: response.previewId,
      }).catch(() => {});
      return;
    }
    finalChunks = chunks;
    preview = response;
    previewPending = false;
    status(
      pages.some((entry) => entry.page.warnings.length)
        ? "Some pages are incomplete. Review their warnings before inserting."
        : "",
    );
    render();
  } catch (error) {
    if (mine !== generation || revision !== previewRevision) return;
    previewPending = false;
    status(
      `Preview unavailable (${error instanceof Error ? error.message : "pdf_failed"}). Reopen the PDF to review again.`,
    );
    render();
  }
}
function command(action: PdfViewerCommand): void {
  if (finalizing) return;
  if (action.type === "cancel") {
    remove();
    return;
  }
  if (action.type === "insert") {
    void finish("insert");
    return;
  }
  if (action.type === "copy") {
    void finish("copy", true);
    return;
  }
  if (action.type === "mode") {
    mode = action.mode;
    render();
    return;
  }
  if (action.type === "select") {
    selectedId = selectedId === action.id ? undefined : action.id;
    render();
    return;
  }
  if (action.type === "page") {
    if (action.pageIndex >= 0 && action.pageIndex < pages.length) {
      pageSelect.value = String(action.pageIndex);
      selectedId = undefined;
      render();
    }
    return;
  }
  if (working || previewPending || action.type !== "action") return;
  for (const [pageIndex, entry] of pages.entries())
    for (const chunk of entry.chunks)
      for (const finding of chunk.findings) {
        if (
          findingId(pageIndex, chunk, finding) === action.id &&
          owned(chunk, finding)
        ) {
          finding.action = action.action;
          void refreshPreview();
          return;
        }
      }
}
async function loadFile(file: File): Promise<void> {
  if (working) return;
  clear();
  const mine = generation;
  abort = new AbortController();
  working = true;
  fileName = file.name;
  el("pdf-file-name").textContent = fileName;
  el("pdf-file-name").title = fileName;
  el("pdf-finding-count").hidden = true;
  cancel.disabled = false;
  pickerState();
  setPhase("reading");
  status("Opening PDF…");
  progress.value = 0;
  el("pdf-progress-label").textContent = "";
  try {
    const { id } = await chrome.windows.getCurrent();
    if (id === undefined) throw new Error("no_window");
    const target = await ask<PdfDraft>({ type: "pdf-target", windowId: id });
    if (mine !== generation) return;
    draft = target;
    originWindow = id;
    const extracted = await extractPdf(file, {
      signal: abort.signal,
      onProgress: (value) => {
        if (mine !== generation) return;
        status(value.stage === "ocr" ? "Reading image text…" : "Reading PDF…");
        progress.max = value.totalPages;
        progress.value = value.pageNumber;
        el("pdf-progress-label").textContent =
          `${value.pageNumber}/${value.totalPages}`;
      },
    });
    if (mine !== generation) return;
    pages = extracted.pages.map((page) => ({
      page,
      chunks: pdfChunks(page.text),
    }));
    if (!pages.some((entry) => entry.page.text.trim()))
      throw new Error("pdf_no_readable_text");
    for (const entry of pages)
      for (const chunk of entry.chunks) {
        if (mine !== generation) return;
        status(`Checking page ${entry.page.pageNumber}…`);
        const response = await ask<{
          findings: PdfFinding[];
          policyVersion: string;
        }>({ type: "pdf-scan", text: chunk.text, draft: target });
        if (mine !== generation) return;
        chunk.findings = response.findings;
        chunk.policyVersion = response.policyVersion;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    if (mine !== generation) return;
    for (const [index, entry] of pages.entries()) {
      const option = document.createElement("option");
      option.textContent = `Page ${entry.page.pageNumber} of ${pages.length}`;
      option.value = String(index);
      pageSelect.append(option);
    }
    working = false;
    setPhase("review");
    render();
    await refreshPreview();
  } catch (error) {
    if (mine !== generation) return;
    clear();
    status(
      `PDF could not be reviewed (${error instanceof Error ? error.message : "pdf_failed"}). Nothing was inserted.`,
    );
  }
}
function remove(): void {
  if (finalizing) return;
  const saving = working && phase === "review";
  clear();
  status(
    saving ? "Review cancelled. Saved replacements remain in your vault." : "",
  );
}
function approvedText(response: PdfPreviewResponse): string {
  return pages
    .map((_, pageIndex) =>
      finalChunks
        .filter((chunk) => chunk.pageIndex === pageIndex)
        .map((chunk) => {
          const result = response.chunks.find((item) => item.id === chunk.id);
          if (!result) throw new Error("pdf_preview_incomplete");
          return result.text;
        })
        .join(""),
    )
    .join("\n\n");
}
async function finish(
  action: "insert" | "copy",
  fromViewer = false,
): Promise<void> {
  if (working || previewPending || !preview || !draft) {
    if (fromViewer) rejectPdfViewerCopy();
    return;
  }
  const mine = generation;
  const target = draft;
  working = true;
  let insertionDispatched = false;
  render();
  status("Saving approved replacements…");
  try {
    await ask({ type: "pdf-check-target", draft: target });
    if (mine !== generation) return;
    if (!committed) {
      const saved = await ask<PdfPreviewResponse>({
        type: "pdf-apply",
        draft: target,
        previewId: preview.previewId,
        policyVersion: preview.policyVersion,
      });
      if (mine !== generation) return;
      preview = saved;
      committed = true;
    }
    const text = approvedText(preview);
    if (action === "copy") {
      if (fromViewer) await copyPdfViewerText(text);
      else await navigator.clipboard.writeText(text);
      if (mine !== generation) return;
      working = false;
      status("Copied as sent.");
      render();
      return;
    }
    finalizing = true;
    render();
    status("Inserting approved text…");
    insertionDispatched = true;
    await ask({ type: "pdf-insert", draft: target, text });
    clear();
    setPhase("inserted");
    status("Inserted into your draft.");
  } catch (error) {
    if (mine !== generation) return;
    const code = error instanceof Error ? error.message : "pdf_failed";
    if (fromViewer) rejectPdfViewerCopy();
    if (action === "copy" && committed) {
      working = false;
      status(
        "Could not copy. Reversible originals are saved; use Copy again to retry.",
      );
      render();
      return;
    }
    status(
      insertionDispatched &&
        !["pdf_draft_changed", "pdf_target_changed"].includes(code)
        ? "Insertion could not be confirmed. Check your chat draft before retrying."
        : `Nothing was inserted (${code}). Reopen the PDF to review again. Saved replacements remain in your vault.`,
    );
    working = false;
    finalizing = false;
    releasePreview();
    render();
  }
}
picker.addEventListener("change", () => {
  const file = picker.files?.[0];
  if (file) void loadFile(file);
});
el("pdf-drop").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    picker.click();
  }
});
for (const type of ["dragenter", "dragover"]) {
  el("pdf-drop").addEventListener(type, (event) => {
    event.preventDefault();
    el("pdf-drop").dataset.dragging = "true";
  });
}
el("pdf-drop").addEventListener("dragleave", () => {
  delete el("pdf-drop").dataset.dragging;
});
el("pdf-drop").addEventListener("drop", (event) => {
  event.preventDefault();
  delete el("pdf-drop").dataset.dragging;
  if (!(event instanceof DragEvent)) return;
  const file = event.dataTransfer?.files[0];
  if (file) void loadFile(file);
});
pageSelect.addEventListener("change", () => {
  selectedId = undefined;
  render();
});
cancel.addEventListener("click", remove);
el("pdf-original").addEventListener("click", () =>
  command({ type: "mode", mode: "original" }),
);
el("pdf-as-sent").addEventListener("click", () =>
  command({ type: "mode", mode: "as-sent" }),
);
insert.addEventListener("click", () => void finish("insert"));
copy.addEventListener("click", () => void finish("copy"));
el("pdf-larger").addEventListener("click", () => {
  if (draft)
    void openPdfViewer(snapshot(), command, {
      windowId: originWindow,
      tabId: draft.tabId,
    }).catch(() =>
      status("The larger view could not open. Continue reviewing here."),
    );
});
el("pdf-another").addEventListener("click", () => {
  clear();
  status("");
  picker.click();
});
window.addEventListener("pagehide", clear);
setPhase("empty");
