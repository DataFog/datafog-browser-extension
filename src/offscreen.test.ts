/**
 * The offscreen document answers forwarded requests and ignores the rest.
 */

import { beforeEach, expect, test, vi } from "vitest";

import { countFindings, redact } from "./detect";
import type { OffscreenRequest, Request } from "./messages";
import { DEFAULT_SETTINGS } from "./settings";

vi.mock("./detect", () => ({
  ready: vi.fn(async () => {}),
  countFindings: vi.fn(() => ({ EMAIL: 1 })),
  redact: vi.fn(() => ({ text: "[EMAIL]", edits: [] })),
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
  });
});

test("skips Core when checking is off", async () => {
  const settings = { ...DEFAULT_SETTINGS, enabled: false };

  expect(
    await forward({ type: "scan", seq: 4, text: "a@b.co" }, settings),
  ).toEqual({ seq: 4, enabled: false, counts: {} });
  expect(countFindings).not.toHaveBeenCalled();
});

test("answers a code when Core fails", async () => {
  vi.mocked(redact).mockImplementationOnce(() => {
    throw Object.assign(new Error("a@b.co"), { code: "invalid_input" });
  });

  expect(await forward({ type: "redact", text: "a@b.co" })).toEqual({
    error: "invalid_input",
  });
});
