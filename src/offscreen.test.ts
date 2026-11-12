/**
 * The offscreen document answers forwarded requests and ignores the rest.
 */

import { beforeEach, expect, test, vi } from "vitest";

import { countFindings, redact } from "./detect";
import type { OffscreenRequest, Request } from "./messages";
import { DEFAULT_SETTINGS } from "./settings";

vi.mock("./detect", () => ({
  ready: vi.fn(async () => {}),
  countFindings: vi.fn(async () => ({ EMAIL: 1 })),
  redact: vi.fn(async () => ({ text: "[EMAIL]", edits: [] })),
  workspaceFindings: vi.fn(async () => []),
  skipChoices: vi.fn((scanner: unknown) => scanner),
}));

// Workers aren't here; the model scanner has its own tests
vi.mock("@datafog/wasm/cnn", () => ({ CnnSession: { open: vi.fn() } }));

// IndexedDB isn't here; device keys have their own tests through the host
vi.mock("./device", () => ({
  DeviceKeys: class {
    async load(): Promise<void> {}
  },
}));

type Listener = (
  message: OffscreenRequest | Request,
  sender: object,
  respond: (response: unknown) => void,
) => boolean;

let listener: Listener;

/**
 * Forward a request as the service worker would.
 *
 * @param request The content script's request.
 * @param settings The settings to send along.
 * @returns The offscreen document's response.
 */
function forward(
  request: OffscreenRequest["request"],
  settings = DEFAULT_SETTINGS,
): Promise<unknown> {
  return new Promise((resolve) =>
    listener({ target: "offscreen", request, settings }, {}, resolve),
  );
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        onMessage: {
          addListener: (added: Listener) => {
            listener = added;
          },
        },
      },
    },
  });
  await import("./offscreen");
});

test("leaves content script messages to the service worker", () => {
  const respond = vi.fn();

  expect(listener({ type: "scan", seq: 1, text: "a@b.co" }, {}, respond)).toBe(
    false,
  );
  expect(respond).not.toHaveBeenCalled();
});

test("counts findings for a forwarded scan", async () => {
  expect(await forward({ type: "scan", seq: 3, text: "a@b.co" })).toEqual({
    seq: 3,
    enabled: true,
    counts: { EMAIL: 1 },
    blockSends: false,
  });
});

test("skips Core when checking is off", async () => {
  const settings = { ...DEFAULT_SETTINGS, enabled: false };

  expect(
    await forward({ type: "scan", seq: 4, text: "a@b.co" }, settings),
  ).toEqual({ seq: 4, enabled: false, counts: {}, blockSends: false });
  expect(countFindings).not.toHaveBeenCalled();
});

test("answers and logs a code when Core fails", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(redact).mockRejectedValueOnce(
    Object.assign(new Error("a@b.co"), { code: "invalid_input" }),
  );

  expect(await forward({ type: "redact", text: "a@b.co" })).toEqual({
    error: "invalid_input",
  });
  expect(warn).toHaveBeenCalledWith("DataFog redact failed: invalid_input");
  expect(JSON.stringify(warn.mock.calls)).not.toContain("a@b.co");
  warn.mockRestore();
});
