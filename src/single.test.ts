// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";

type Single = typeof import("./single");

async function load(): Promise<Single> {
  vi.resetModules();
  return import("./single");
}

test("one live copy per page: a duplicate stops, an orphan hands over", async () => {
  vi.stubGlobal("chrome", { runtime: { id: "datafog" } });
  const first = await load();
  expect(first.claimPage()).toBe(true);

  // A second live copy, such as an injection racing the page's own load
  const duplicate = await load();
  expect(duplicate.claimPage()).toBe(false);
  expect(first.isRetired()).toBe(false);

  // After an update the first copy is orphaned: its context is gone
  const undo = vi.fn();
  first.onRetire(undo);
  vi.stubGlobal("chrome", { runtime: {} });
  const fresh = await load();
  expect(fresh.claimPage()).toBe(true);
  expect(first.isRetired()).toBe(true);
  expect(undo).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
