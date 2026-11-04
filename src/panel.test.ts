// @vitest-environment happy-dom
/**
 * The side panel's connection to the service worker.
 */

import { expect, test, vi } from "vitest";

test("closes when told to, and reconnects when the worker stops", async () => {
  document.body.innerHTML = '<button id="settings"></button>';
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  const messages: (() => void)[] = [];
  const drops: (() => void)[] = [];
  const connect = vi.fn(() => ({
    onMessage: { addListener: (added: () => void) => messages.push(added) },
    onDisconnect: { addListener: (added: () => void) => drops.push(added) },
  }));
  Object.assign(globalThis, {
    chrome: {
      runtime: { connect, openOptionsPage: vi.fn() },
      windows: { getCurrent: vi.fn(async () => ({ id: 3 })) },
    },
  });

  await import("./panel");
  await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
  expect(connect).toHaveBeenCalledWith({ name: "3" });

  drops[0]();
  await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));

  messages[1]();
  expect(close).toHaveBeenCalled();
});
