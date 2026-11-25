import { afterEach, describe, it, expect, vi } from "vitest";
import {
  openPdfViewer,
  closePdfViewer,
  copyPdfViewerText,
  rejectPdfViewerCopy,
} from "./pdf-viewer-client";
import type { PdfViewerSnapshot } from "./pdf-view";
class Channel {
  static latest: Channel;
  listener?: (event: { data: unknown }) => void;
  postMessage = vi.fn();
  close = vi.fn();
  constructor() {
    Channel.latest = this;
  }
  addEventListener(
    _type: string,
    listener: (event: { data: unknown }) => void,
  ) {
    this.listener = listener;
  }
}
const snapshot: PdfViewerSnapshot = {
  fileName: "private.pdf",
  pages: [{ pageNumber: 1, text: "Private text", warnings: [], findings: [] }],
  pageIndex: 0,
  working: false,
  status: "Ready",
};
function setup(activeTab = 5) {
  const update = vi.fn(async () => ({}));
  const remove = vi.fn(async () => {});
  vi.stubGlobal("BroadcastChannel", Channel);
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    windows: {
      get: vi.fn(async () => ({
        left: 100,
        top: 100,
        width: 1400,
        height: 900,
      })),
      create: vi.fn(async () => ({ id: 42 })),
      update,
      remove,
    },
    tabs: { query: vi.fn(async () => [{ id: activeTab }]) },
  });
  return { update, remove };
}
afterEach(() => {
  closePdfViewer();
  vi.unstubAllGlobals();
});
describe("extension-owned PDF viewer bridge", () => {
  it("declines insertion when original browser window changed its active tab", async () => {
    const { update } = setup(8);
    const callback = vi.fn();
    await openPdfViewer(snapshot, callback, { windowId: 3, tabId: 5 });
    Channel.latest.listener?.({
      data: { type: "command", command: { type: "insert" } },
    });
    await vi.waitFor(() =>
      expect(Channel.latest.postMessage).toHaveBeenCalled(),
    );
    expect(callback).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(
      Channel.latest.postMessage.mock.calls.at(-1)?.[0].snapshot.status,
    ).toContain("active chat changed");
  });
  it("focuses only the existing origin window before dispatching insertion", async () => {
    const { update } = setup();
    const callback = vi.fn();
    await openPdfViewer(snapshot, callback, { windowId: 3, tabId: 5 });
    Channel.latest.listener?.({
      data: { type: "command", command: { type: "insert" } },
    });
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith({ type: "insert" }),
    );
    expect(update).toHaveBeenCalledWith(3, { focused: true });
  });
  it("ignores unrecognized finding IDs and closes channel on cancellation", async () => {
    setup();
    const callback = vi.fn();
    await openPdfViewer(snapshot, callback, { windowId: 3, tabId: 5 });
    Channel.latest.listener?.({
      data: {
        type: "command",
        command: { type: "action", id: "unknown", action: "keep" },
      },
    });
    expect(callback).not.toHaveBeenCalled();
    closePdfViewer();
    expect(Channel.latest.close).toHaveBeenCalledOnce();
  });
  it("copies only approved text and resolves after viewer confirmation", async () => {
    const { update } = setup();
    const callback = vi.fn();
    await openPdfViewer(snapshot, callback, { windowId: 3, tabId: 5 });
    Channel.latest.listener?.({
      data: { type: "command", command: { type: "copy" } },
    });
    expect(callback).toHaveBeenCalledWith({ type: "copy" });
    expect(update).not.toHaveBeenCalled();
    const copied = copyPdfViewerText("Approved [[EMAIL_TOKEN]]");
    const message = Channel.latest.postMessage.mock.calls.at(-1)?.[0];
    expect(message.text).toBe("Approved [[EMAIL_TOKEN]]");
    Channel.latest.listener?.({
      data: { type: "copy-result", requestId: message.requestId, ok: true },
    });
    await copied;
  });
  it("rejects pending copy promptly when the viewer closes", async () => {
    setup();
    await openPdfViewer(snapshot, () => {}, { windowId: 3, tabId: 5 });
    const copied = copyPdfViewerText("Approved");
    rejectPdfViewerCopy();
    expect(Channel.latest.postMessage).toHaveBeenLastCalledWith({
      type: "copy-rejected",
    });
    closePdfViewer();
    await expect(copied).rejects.toThrow("closed");
  });
});
