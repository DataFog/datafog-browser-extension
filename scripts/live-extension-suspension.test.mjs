import { describe, expect, it, vi } from "vitest";
import { withSuspendedLocalExtension } from "./live-extension-suspension.mjs";

function setup(extensionPath = "/repo/dist") {
  const original = {
    id: "original",
    name: "DataFog",
    path: extensionPath,
    enabled: true,
  };
  const session = {
    send: vi.fn(async (command) => {
      if (command !== "Extensions.getExtensions")
        throw new Error("Unexpected mutation of extension data");
      return { extensions: [{ ...original }] };
    }),
    detach: vi.fn(),
  };
  const toggle = {
    evaluate: vi.fn(async () => original.enabled),
    click: vi.fn(async () => {
      original.enabled = !original.enabled;
    }),
  };
  const page = { goto: vi.fn(), locator: vi.fn(() => toggle), close: vi.fn() };
  const browser = {
    newBrowserCDPSession: vi.fn(async () => session),
    contexts: () => [{ newPage: async () => page }],
    close: vi.fn(),
  };
  return {
    original,
    session,
    toggle,
    browser,
    connect: vi.fn(async () => browser),
  };
}

describe("existing browser extension isolation", () => {
  for (const fails of [false, true])
    it(`restores original enabled state after ${fails ? "failure" : "success"} without uninstalling`, async () => {
      const fixture = setup();
      const operation = withSuspendedLocalExtension(
        "http://localhost:9333",
        "/repo",
        async (id) => {
          expect(id).toBe("original");
          expect(fixture.original.enabled).toBe(false);
          if (fails) throw new Error("live assertion failed");
          return "passed";
        },
        fixture.connect,
      );
      if (fails)
        await expect(operation).rejects.toThrow("live assertion failed");
      else await expect(operation).resolves.toBe("passed");
      expect(fixture.original.enabled).toBe(true);
      expect(fixture.toggle.click).toHaveBeenCalledTimes(2);
      expect(fixture.browser.close).toHaveBeenCalledOnce();
    });
  it("refuses an unrelated installation before any mutation", async () => {
    const fixture = setup("/personal/datafog");
    const run = vi.fn();
    await expect(
      withSuspendedLocalExtension(
        "http://localhost:9333",
        "/repo",
        run,
        fixture.connect,
      ),
    ).rejects.toThrow("different datafog installation");
    expect(run).not.toHaveBeenCalled();
    expect(fixture.toggle.click).not.toHaveBeenCalled();
    expect(fixture.original.enabled).toBe(true);
  });
  it("restores when disabling changed state but its acknowledgement fails", async () => {
    const fixture = setup();
    fixture.toggle.click.mockImplementationOnce(async () => {
      fixture.original.enabled = false;
      throw new Error("interrupted");
    });
    await expect(
      withSuspendedLocalExtension(
        "http://localhost:9333",
        "/repo",
        vi.fn(),
        fixture.connect,
      ),
    ).rejects.toThrow("interrupted");
    expect(fixture.original.enabled).toBe(true);
  });
  it("accepts only a paired exact already-disabled original without taking restoration ownership", async () => {
    const fixture = setup("/outer/dist");
    fixture.original.enabled = false;
    const run = vi.fn(async () => "nested passed");
    await expect(
      withSuspendedLocalExtension(
        "http://localhost:9333",
        "/stage",
        run,
        fixture.connect,
        { id: "original", path: "/outer/dist" },
      ),
    ).resolves.toBe("nested passed");
    expect(run).toHaveBeenCalledWith("original", "/outer/dist");
    expect(fixture.toggle.click).not.toHaveBeenCalled();
    expect(fixture.original.enabled).toBe(false);
  });
  it.each([
    { id: "original" },
    { id: "original", path: "relative" },
    { id: "original", path: "/wrong/dist" },
  ])(
    "rejects incomplete or mismatched inherited suspension %j",
    async (inherited) => {
      const fixture = setup();
      fixture.original.enabled = false;
      const run = vi.fn();
      await expect(
        withSuspendedLocalExtension(
          "http://localhost:9333",
          "/stage",
          run,
          fixture.connect,
          inherited,
        ),
      ).rejects.toThrow();
      expect(run).not.toHaveBeenCalled();
      expect(fixture.toggle.click).not.toHaveBeenCalled();
    },
  );
});
