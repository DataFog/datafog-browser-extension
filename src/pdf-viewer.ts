/* BroadcastChannel is origin-scoped and does not take a targetOrigin argument. */
/* eslint-disable unicorn/require-post-message-target-origin */
import {
  renderPdfView,
  findingControls,
  findingDisplay,
  type PdfViewerSnapshot,
  type PdfViewerCommand,
} from "./pdf-view";
const el = (id: string) => document.getElementById(id)!;
const key = location.hash.slice(1);
let snapshot: PdfViewerSnapshot | undefined;
let clipboard:
  | {
      resolve: (blob: Blob) => void;
      reject: (error: Error) => void;
      result: Promise<boolean>;
      timer: ReturnType<typeof setTimeout>;
    }
  | undefined;
function startCopy(): void {
  clipboard?.reject(new Error("Copy superseded."));
  if (clipboard) clearTimeout(clipboard.timer);
  let resolveBlob!: (blob: Blob) => void;
  let rejectBlob!: (error: Error) => void;
  const blob = new Promise<Blob>((resolve, reject) => {
    resolveBlob = resolve;
    rejectBlob = reject;
  });
  // Start the write during the click; supply committed text only after vault success.
  const result = navigator.clipboard
    .write([new ClipboardItem({ "text/plain": blob })])
    .then(
      () => true,
      () => false,
    );
  const timer = setTimeout(
    () => rejectBlob(new Error("Copy approval timed out.")),
    20000,
  );
  clipboard = { resolve: resolveBlob, reject: rejectBlob, result, timer };
  command({ type: "copy" });
}
const channel = /^[a-f\d-]{36}$/i.test(key)
  ? new BroadcastChannel(`datafog-pdf-${key}`)
  : undefined;
function command(value: PdfViewerCommand): void {
  channel?.postMessage({ type: "command", command: value });
}
function render(): void {
  if (!snapshot) return;
  const state = snapshot;
  const page = state.pages[state.pageIndex];
  if (!page) return;
  el("file-name").textContent = state.fileName;
  document.title = `${state.fileName} · DataFog`;
  el("status").textContent = state.status;
  el("page-warning").textContent = page.warnings.join(" ");
  el("page-count").textContent =
    `Page ${page.pageNumber} of ${state.pages.length}`;
  el("original").setAttribute("aria-pressed", String(state.mode !== "as-sent"));
  el("as-sent").setAttribute("aria-pressed", String(state.mode === "as-sent"));
  renderPdfView(el("document-text"), state, command);
  const list = el("finding-list");
  list.replaceChildren();
  el("finding-count").textContent =
    `${page.findings.length} ${page.findings.length === 1 ? "item" : "items"} found`;
  for (const finding of page.findings) {
    const row = document.createElement("li");
    row.classList.toggle("selected", finding.id === state.selectedId);
    const label = document.createElement("span");
    label.className = "finding-label";
    label.textContent = finding.entityType.replaceAll("_", " ");
    const original = document.createElement("button");
    original.type = "button";
    original.className = "finding-original";
    original.textContent = finding.original;
    original.disabled = state.working;
    original.addEventListener("click", () =>
      command({ type: "select", id: finding.id }),
    );
    row.append(label, original);
    if (finding.action !== "keep") {
      const replacement = document.createElement("span");
      replacement.className = "finding-replacement";
      replacement.textContent = findingDisplay(finding, "as-sent");
      row.append(replacement);
    }
    row.append(findingControls(finding, state.working, command));
    list.append(row);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "#insert,#copy,#original,#as-sent",
  ))
    button.disabled = state.working;
  const previous = document.querySelector<HTMLButtonElement>("#previous")!;
  previous.disabled = state.working || state.pageIndex === 0;
  const next = document.querySelector<HTMLButtonElement>("#next")!;
  next.disabled = state.working || state.pageIndex >= state.pages.length - 1;
}
channel?.addEventListener("message", (event) => {
  if (
    event.data?.type === "copy-approved" &&
    typeof event.data.text === "string" &&
    typeof event.data.requestId === "string"
  ) {
    const { text, requestId } = event.data;
    const pending = clipboard;
    clipboard = undefined;
    if (!pending) {
      channel?.postMessage({ type: "copy-result", requestId, ok: false });
      return;
    }
    clearTimeout(pending.timer);
    pending.resolve(new Blob([text], { type: "text/plain" }));
    void pending.result.then((ok) =>
      channel?.postMessage({ type: "copy-result", requestId, ok }),
    );
  } else if (event.data?.type === "copy-rejected") {
    if (clipboard) {
      clearTimeout(clipboard.timer);
      clipboard.reject(new Error("Copy was not approved."));
      clipboard = undefined;
    }
  } else if (event.data?.type === "snapshot") {
    snapshot = event.data.snapshot;
    render();
  } else if (event.data?.type === "close") window.close();
});
for (const mode of ["original", "as-sent"] as const)
  el(mode).addEventListener("click", () => command({ type: "mode", mode }));
el("previous").addEventListener("click", () => {
  if (snapshot) command({ type: "page", pageIndex: snapshot.pageIndex - 1 });
});
el("next").addEventListener("click", () => {
  if (snapshot) command({ type: "page", pageIndex: snapshot.pageIndex + 1 });
});
el("insert").addEventListener("click", () => command({ type: "insert" }));
el("copy").addEventListener("click", startCopy);
for (const id of ["back", "close"])
  el(id).addEventListener("click", () => window.close());
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.close();
});
window.addEventListener("pagehide", () => {
  if (clipboard) {
    clearTimeout(clipboard.timer);
    clipboard.reject(new Error("Viewer closed."));
    clipboard = undefined;
  }
  channel?.close();
});
channel?.postMessage({ type: "ready" });
if (!channel)
  el("status").textContent = "Open this viewer from the DataFog sidebar.";
