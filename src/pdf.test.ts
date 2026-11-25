import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPdf } from "./pdf";
const created: {
  terminate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  messageHandler?: (event: { data: unknown }) => void;
}[] = [];
class MockWorker {
  terminate = vi.fn();
  postMessage = vi.fn();
  messageHandler?: (event: { data: unknown }) => void;
  addEventListener(type: string, callback: (event: { data: unknown }) => void) {
    if (type === "message") this.messageHandler = callback;
  }
  constructor() {
    created.push(this);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  created.length = 0;
});
const setup = () => {
  vi.stubGlobal("Worker", MockWorker);
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
  });
};
describe("PDF worker lifecycle", () => {
  it("does not start a worker for an already cancelled selection", async () => {
    setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractPdf(new File(["pdf"], "test.pdf"), { signal: controller.signal }),
    ).rejects.toThrow();
    expect(created).toHaveLength(0);
  });
  it("terminates immediately during processing and rejects cancellation", async () => {
    setup();
    const controller = new AbortController();
    const promise = extractPdf(new File(["pdf"], "test.pdf"), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(created).toHaveLength(1));
    controller.abort();
    await expect(promise).rejects.toThrow();
    expect(created[0].terminate).toHaveBeenCalledOnce();
  });
  it("transfers the document buffer and releases the worker after completion", async () => {
    setup();
    const promise = extractPdf(new File(["pdf"], "test.pdf"));
    await vi.waitFor(() => expect(created).toHaveLength(1));
    const [bytes, transfer] = created[0].postMessage.mock.calls[0];
    expect(transfer).toEqual([bytes]);
    created[0].messageHandler?.({
      data: { kind: "result", result: { pages: [], warnings: [] } },
    });
    expect(await promise).toEqual({ pages: [], warnings: [] });
    expect(created[0].terminate).toHaveBeenCalledOnce();
  });
});
