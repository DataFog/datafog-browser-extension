import { describe, expect, it, vi } from "vitest";
import { withSuspendedLocalExtension } from "./live-extension-suspension.mjs";

function setup(extensionPath = "/repo/dist") {
  const original = {
    id: "original",
    name: "DataFog",
    path: extensionPath,
    enabled: true,
  };

  let ownedUrl;
  const session = {
    send: vi.fn(async (command) => {
      if (command === "Target.getTargetInfo")
        return {
          targetInfo: {
            browserContextId: "verified-profile",
            targetId: "owned-page",
          },
        };
      if (command === "Target.activateTarget") return {};
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
  const page = {
    evaluate: vi.fn(async (_, url) => {
      ownedUrl = url;
    }),
    url: () => ownedUrl,
    goto: vi.fn(),
    locator: vi.fn(() => toggle),
    close: vi.fn(),
  };
  const browser = {
    newBrowserCDPSession: vi.fn(async () => session),
    contexts: () => [
      {
        pages: () => [page],
        newCDPSession: async () => session,
        waitForEvent: async () => page,
      },
    ],
    close: vi.fn(),
  };
  return {
    original,
    session,
    toggle,
    page,
    browser,
    connect: vi.fn(async () => browser),
  };
}

describe("existing browser extension isolation", () => {
  vi.stubEnv("LIVE_BROWSER_CONTEXT_ID", "verified-profile");
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
    expect(run).toHaveBeenCalledWith(
      "original",
      "/outer/dist",
      "verified-profile",
    );
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

it("creates the extension manager in the verified profile and refuses context drift before cleanup", async () => {
  const fixture = setup();
  await expect(
    withSuspendedLocalExtension(
      "http://localhost:9333",
      "/repo",
      async () => {
        fixture.session.send.mockImplementation(async (command) => {
          if (command === "Target.getTargetInfo")
            return { targetInfo: { browserContextId: "different-profile" } };
          throw new Error("Must not read or mutate another profile");
        });
      },
      fixture.connect,
      { contextId: "verified-profile" },
    ),
  ).rejects.toThrow("changed browser profile");
  expect(fixture.page.evaluate).toHaveBeenCalledOnce();
  expect(fixture.toggle.click).toHaveBeenCalledTimes(1);
});

it("suspends an explicitly identified external original for isolated-checkout hooks without nested ownership", async () => {
  const fixture = setup("/original/dist");
  await withSuspendedLocalExtension(
    "http://localhost:9333",
    "/isolated",
    async () => {
      expect(fixture.original.enabled).toBe(false);
    },
    fixture.connect,
    {
      contextId: "verified-profile",
      originalId: "original",
      originalPath: "/original/dist",
    },
  );
  expect(fixture.original.enabled).toBe(true);
  expect(fixture.toggle.click).toHaveBeenCalledTimes(2);
});

it("refuses a different external original ID even when its unpacked path matches", async () => {
  const fixture = setup("/original/dist");
  await expect(
    withSuspendedLocalExtension(
      "http://localhost:9333",
      "/isolated",
      vi.fn(),
      fixture.connect,
      {
        contextId: "verified-profile",
        originalId: "different",
        originalPath: "/original/dist",
      },
    ),
  ).rejects.toThrow("different datafog installation");
  expect(fixture.toggle.click).not.toHaveBeenCalled();
});
