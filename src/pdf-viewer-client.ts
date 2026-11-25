/* BroadcastChannel is origin-scoped and does not take a targetOrigin argument. */
/* eslint-disable unicorn/require-post-message-target-origin */
import type { PdfViewerSnapshot, PdfViewerCommand } from "./pdf-view";
let channel: BroadcastChannel | undefined;
let viewerWindow: number | undefined;
let latest: PdfViewerSnapshot | undefined;
let version = 0;
const pendingCopies = new Map<
  string,
  {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
/** Only committed, approved text may be sent to the focused extension popup clipboard. */
export function rejectPdfViewerCopy(): void {
  channel?.postMessage({ type: "copy-rejected" });
}
export function copyPdfViewerText(text: string): Promise<void> {
  if (!channel) return Promise.reject(new Error("PDF viewer is closed."));
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingCopies.delete(requestId);
      reject(
        new Error(
          "Copy could not be confirmed. Keep the larger view focused and try again.",
        ),
      );
    }, 10000);
    pendingCopies.set(requestId, { resolve, reject, timer });
    channel?.postMessage({ type: "copy-approved", requestId, text });
  });
}
export function updatePdfViewer(snapshot: PdfViewerSnapshot): void {
  latest = snapshot;
  channel?.postMessage({ type: "snapshot", snapshot });
}
export function closePdfViewer(): void {
  version++;
  for (const pending of pendingCopies.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("PDF viewer closed before copy completed."));
  }
  pendingCopies.clear();
  channel?.postMessage({ type: "close" });
  channel?.close();
  channel = undefined;
  latest = undefined;
  if (viewerWindow !== undefined)
    void chrome.windows.remove(viewerWindow).catch(() => {});
  viewerWindow = undefined;
}
export function isViewerCommand(value: unknown): value is PdfViewerCommand {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  switch (value.type) {
    case "insert":
    case "cancel":
    case "copy":
      return true;
    case "page":
      return (
        "pageIndex" in value &&
        typeof value.pageIndex === "number" &&
        Number.isInteger(value.pageIndex)
      );
    case "mode":
      return (
        "mode" in value &&
        (value.mode === "original" || value.mode === "as-sent")
      );
    case "select":
      return "id" in value && typeof value.id === "string";
    case "action":
      return (
        "id" in value &&
        typeof value.id === "string" &&
        "action" in value &&
        ["keep", "redact", "replace"].includes(String(value.action))
      );
    default:
      return false;
  }
}
export async function openPdfViewer(
  snapshot: PdfViewerSnapshot,
  onCommand: (command: PdfViewerCommand) => void,
  origin?: { windowId: number; tabId: number },
): Promise<void> {
  closePdfViewer();
  const mine = version;
  latest = snapshot;
  const key = crypto.randomUUID();
  channel = new BroadcastChannel(`datafog-pdf-${key}`);
  channel.addEventListener("message", (event) => {
    if (
      event.data?.type === "copy-result" &&
      typeof event.data.requestId === "string"
    ) {
      const pending = pendingCopies.get(event.data.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingCopies.delete(event.data.requestId);
        if (event.data.ok === true) pending.resolve();
        else
          pending.reject(
            new Error(
              "Clipboard access failed. Keep the larger view focused and try again.",
            ),
          );
      }
      return;
    }
    if (event.data?.type === "ready") {
      if (latest) channel?.postMessage({ type: "snapshot", snapshot: latest });
      return;
    }
    const command: unknown = event.data?.command;
    if (event.data?.type !== "command" || !isViewerCommand(command) || !latest)
      return;
    if (
      "id" in command &&
      !latest.pages.some((page) =>
        page.findings.some((finding) => finding.id === command.id),
      )
    )
      return;
    if (
      command.type === "page" &&
      (command.pageIndex < 0 || command.pageIndex >= latest.pages.length)
    )
      return;
    if (latest.working && command.type !== "cancel") {
      if (command.type === "copy") rejectPdfViewerCopy();
      return;
    }
    if (command.type === "insert" && origin) {
      void (async () => {
        try {
          const [active] = await chrome.tabs.query({
            windowId: origin.windowId,
            active: true,
          });
          if (active?.id !== origin.tabId) {
            if (latest)
              updatePdfViewer({
                ...latest,
                status:
                  "The active chat changed. Return to the original chat and review before inserting.",
              });
            return;
          }
          await chrome.windows.update(origin.windowId, { focused: true });
          if (mine === version) onCommand(command);
        } catch {
          if (latest)
            updatePdfViewer({
              ...latest,
              status:
                "The original chat is unavailable. Return to the sidebar to review.",
            });
        }
      })();
    } else onCommand(command);
  });
  try {
    const parent = origin
      ? await chrome.windows.get(origin.windowId)
      : await chrome.windows.getCurrent();
    const available = typeof screen === "undefined" ? undefined : screen;
    const screenLeft =
      available &&
      "availLeft" in available &&
      typeof available.availLeft === "number"
        ? available.availLeft
        : 0;
    const screenTop =
      available &&
      "availTop" in available &&
      typeof available.availTop === "number"
        ? available.availTop
        : 0;
    const availableWidth = available?.availWidth || parent.width || 1120;
    const availableHeight = available?.availHeight || parent.height || 760;
    const width = Math.min(1120, parent.width ?? 1120, availableWidth);
    const height = Math.min(760, parent.height ?? 760, availableHeight);
    const left = Math.max(
      screenLeft,
      Math.min(
        screenLeft + availableWidth - width,
        Math.round(
          (parent.left ?? screenLeft) + ((parent.width ?? width) - width) / 2,
        ),
      ),
    );
    const top = Math.max(
      screenTop,
      Math.min(
        screenTop + availableHeight - height,
        Math.round(
          (parent.top ?? screenTop) + ((parent.height ?? height) - height) / 2,
        ),
      ),
    );
    const popup = await chrome.windows.create({
      url: chrome.runtime.getURL(`pdf-viewer.html#${key}`),
      type: "popup",
      focused: true,
      width,
      height,
      left,
      top,
    });
    if (!popup) throw new Error("PDF viewer could not be opened.");
    if (mine !== version) {
      if (popup.id !== undefined) await chrome.windows.remove(popup.id);
      return;
    }
    viewerWindow = popup.id;
  } catch (error) {
    closePdfViewer();
    throw error;
  }
}
