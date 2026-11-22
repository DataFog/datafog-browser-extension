import { expect, test, vi } from "vitest";
import {
  createPinnedPage,
  requireContext,
  type TargetIdentity,
} from "../e2e/browser-context";

function transport(contextId = "chosen-profile", targetId = "owned-target") {
  const page = { name: "test-owned-page" };
  const target: TargetIdentity = { targetId, browserContextId: contextId };
  return {
    page,
    api: {
      create: vi.fn(async () => "owned-target"),
      resolve: vi.fn(async () => ({
        page,
        target,
      })),
      close: vi.fn(async () => {}),
    },
  };
}

test("opener-bound pages require the explicit profile even when another profile is active", async () => {
  const { page, api } = transport();
  expect(await createPinnedPage("chosen-profile", api)).toBe(page);
  expect(api.create).toHaveBeenCalledWith(
    expect.stringMatching(/^about:blank#datafog-owned-/),
    "chosen-profile",
  );
  expect(api.close).not.toHaveBeenCalled();
});
test.each(["other-profile", undefined])(
  "a wrong or absent resolved profile fails closed without closing the foreign page (%s)",
  async (actual) => {
    const { api } = transport();
    api.resolve.mockResolvedValue({
      page: { name: "foreign" },
      target: { targetId: "foreign-target", browserContextId: actual },
    });
    await expect(createPinnedPage("chosen-profile", api)).rejects.toThrow();
    expect(api.close).toHaveBeenCalledExactlyOnceWith("owned-target");
  },
);
test("matching target id in a different profile is rejected", async () => {
  const { api } = transport("other-profile");
  await expect(createPinnedPage("chosen-profile", api)).rejects.toThrow(
    "outside",
  );
  expect(api.close).toHaveBeenCalledExactlyOnceWith("owned-target");
});
test("partial target attachment failure cleans only the newly created target", async () => {
  const { api } = transport();
  api.resolve.mockRejectedValue(new Error("attachment failed"));
  await expect(createPinnedPage("chosen-profile", api)).rejects.toThrow(
    "attachment failed",
  );
  expect(api.close).toHaveBeenCalledExactlyOnceWith("owned-target");
});
test("missing profile pin prevents creation and metadata guards reject unpinned workers", async () => {
  const { api } = transport();
  await expect(createPinnedPage("", api)).rejects.toThrow("explicit");
  expect(api.create).not.toHaveBeenCalled();
  expect(() =>
    requireContext({ targetId: "worker" }, "chosen-profile"),
  ).toThrow("outside");
});
