/** Shared document view; only mounted inside extension-owned pages. */
export type PdfViewMode = "original" | "as-sent";
export type PdfViewAction = "replace" | "redact" | "keep";
export interface PdfViewFinding {
  id: string;
  start: number;
  end: number;
  original: string;
  entityType: string;
  action: PdfViewAction;
  replacement?: string;
}
export interface PdfViewPage {
  pageNumber: number;
  text: string;
  warnings: string[];
  findings: PdfViewFinding[];
}
export interface PdfViewerSnapshot {
  fileName: string;
  pages: PdfViewPage[];
  pageIndex: number;
  working: boolean;
  status: string;
  mode?: PdfViewMode;
  selectedId?: string;
}
export type PdfViewerCommand =
  | { type: "action"; id: string; action: PdfViewAction }
  | { type: "page"; pageIndex: number }
  | { type: "mode"; mode: PdfViewMode }
  | { type: "select"; id: string }
  | { type: "insert" | "cancel" | "copy" };
export function findingDisplay(
  finding: PdfViewFinding,
  mode: PdfViewMode,
): string {
  if (mode === "original" || finding.action === "keep") return finding.original;
  // A missing reversible preview must never masquerade as the final token.
  return (
    finding.replacement ??
    (finding.action === "redact"
      ? `[${finding.entityType}]`
      : "[Preparing reversible mask…]")
  );
}
export function validViewFindings(page: PdfViewPage): PdfViewFinding[] {
  let end = 0;
  return page.findings
    .toSorted((a, b) => a.start - b.start)
    .filter((finding) => {
      if (
        finding.start < end ||
        finding.start < 0 ||
        finding.end <= finding.start ||
        finding.end > page.text.length ||
        page.text.slice(finding.start, finding.end) !== finding.original
      )
        return false;
      end = finding.end;
      return true;
    });
}
export function findingControls(
  finding: PdfViewFinding,
  working: boolean,
  onCommand: (command: PdfViewerCommand) => void,
): HTMLElement {
  const controls = document.createElement("div");
  controls.className = "pdf-value-controls";
  const check = document.createElement("button");
  check.type = "button";
  check.className = "pdf-value-check";
  check.setAttribute("role", "checkbox");
  check.setAttribute("aria-checked", String(finding.action !== "keep"));
  check.setAttribute("aria-label", `Protect ${finding.original}`);
  check.textContent = finding.action === "keep" ? "○" : "✓";
  check.disabled = working;
  check.addEventListener("click", () =>
    onCommand({
      type: "action",
      id: finding.id,
      action: finding.action === "keep" ? "replace" : "keep",
    }),
  );
  controls.append(check);
  for (const [action, label] of [
    ["redact", "Mask"],
    ["replace", "Reversible mask"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(finding.action === action));
    button.disabled = working;
    button.addEventListener("click", () =>
      onCommand({ type: "action", id: finding.id, action }),
    );
    controls.append(button);
  }
  return controls;
}
export function renderPdfView(
  container: HTMLElement,
  snapshot: PdfViewerSnapshot,
  onCommand: (command: PdfViewerCommand) => void,
  options?: { mode?: PdfViewMode; selectedId?: string },
): void {
  const page = snapshot.pages[snapshot.pageIndex];
  container.replaceChildren();
  container.classList.add("pdf-document-text");
  if (!page) return;
  const mode = options?.mode ?? snapshot.mode ?? "original";
  const selectedId = options?.selectedId ?? snapshot.selectedId;
  let cursor = 0;
  for (const finding of validViewFindings(page)) {
    container.append(
      document.createTextNode(page.text.slice(cursor, finding.start)),
    );
    const wrap = document.createElement("span");
    wrap.className = "pdf-inline-wrap";
    const mark = document.createElement("button");
    mark.type = "button";
    mark.className = `pdf-inline-value ${finding.action}`;
    mark.dataset.findingId = finding.id;
    mark.textContent = findingDisplay(finding, mode);
    mark.setAttribute(
      "aria-label",
      `${finding.entityType}: ${mark.textContent}`,
    );
    mark.setAttribute("aria-expanded", String(finding.id === selectedId));
    mark.disabled = snapshot.working;
    mark.addEventListener("click", () =>
      onCommand({ type: "select", id: finding.id }),
    );
    wrap.append(mark);
    if (finding.id === selectedId) {
      const controls = findingControls(finding, snapshot.working, onCommand);
      controls.classList.add("pdf-inline-controls");
      controls.setAttribute("aria-label", `Controls for ${finding.original}`);
      wrap.append(controls);
    }
    container.append(wrap);
    cursor = finding.end;
  }
  container.append(document.createTextNode(page.text.slice(cursor)));
}
