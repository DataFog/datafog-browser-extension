import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  TestExtensionInstallation,
  type ExtensionInstaller,
  type InstalledExtension,
} from "../e2e/extension-installation";

const testPath = "/tmp/current-test/unpacked-extension";
function installer(initial: InstalledExtension[] = []) {
  const extensions = [...initial];
  const removed: string[] = [];
  const calls = { load: 0, uncertain: false, removalFails: false };
  const api: ExtensionInstaller = {
    list: async () => [...extensions],
    load: async (extensionPath) => {
      calls.load++;
      if (!extensions.some((extension) => extension.id === "test-id"))
        extensions.push({
          id: "test-id",
          name: "datafog",
          path: extensionPath,
          enabled: true,
        });
      if (calls.uncertain)
        throw new Error("Connection closed after installation");
      return "test-id";
    },
    uninstall: async (id) => {
      if (calls.removalFails) throw new Error("Browser unavailable");
      removed.push(id);
      const index = extensions.findIndex((extension) => extension.id === id);
      if (index !== -1) extensions.splice(index, 1);
    },
  };
  return { api, extensions, removed, calls };
}

test.each([true, false])(
  "preserves a preexisting datafog vault even when enabled=%s",
  async (enabled) => {
    const existing = {
      id: "personal",
      name: "DataFog",
      path: "/personal/datafog",
      enabled,
    };
    const browser = installer([existing]);
    const installation = new TestExtensionInstallation(testPath);
    await expect(installation.load(browser.api, true)).rejects.toThrow(
      "already has datafog",
    );
    await installation.remove(browser.api);
    expect(browser.calls.load).toBe(0);
    expect(browser.removed).toEqual([]);
    expect(browser.extensions).toEqual([existing]);
  },
);

test("successful teardown removes only this test's installation and is idempotent", async () => {
  const other = {
    id: "other",
    name: "Password manager",
    path: "/personal/other",
    enabled: true,
  };
  const browser = installer([other]);
  const installation = new TestExtensionInstallation(testPath);
  await installation.load(browser.api, true);
  const addedLater = {
    id: "later",
    name: "datafog",
    path: "/personal/later",
    enabled: true,
  };
  browser.extensions.push(addedLater);
  await installation.remove(browser.api);
  await installation.remove(browser.api);
  expect(browser.removed).toEqual(["test-id"]);
  expect(browser.extensions).toEqual([other, addedLater]);
});

test("a load that installs before losing its response is still cleaned up", async () => {
  const browser = installer();
  browser.calls.uncertain = true;
  const installation = new TestExtensionInstallation(testPath);
  await expect(installation.load(browser.api, true)).rejects.toThrow(
    "Connection closed",
  );
  await installation.remove(browser.api);
  expect(browser.extensions).toEqual([]);
  expect(browser.removed).toEqual(["test-id"]);
});

test("restarting the same test preserves ownership without claiming preexisting paths", async () => {
  const browser = installer();
  const installation = new TestExtensionInstallation(testPath);
  await installation.load(browser.api, true);
  await installation.load(browser.api, true);
  await installation.remove(browser.api);
  expect(browser.removed).toEqual(["test-id"]);
  const preexisting = installer([
    {
      id: "existing-path",
      name: "Unrelated name",
      path: testPath,
      enabled: true,
    },
  ]);
  const fresh = new TestExtensionInstallation(testPath);
  await expect(fresh.load(preexisting.api, false)).rejects.toThrow(
    "already has datafog",
  );
  await fresh.remove(preexisting.api);
  expect(preexisting.removed).toEqual([]);
});

test("uninstall failures are reported and preserve ownership for retry", async () => {
  const browser = installer();
  const installation = new TestExtensionInstallation(testPath);
  await installation.load(browser.api, true);
  browser.calls.removalFails = true;
  await expect(installation.remove(browser.api)).rejects.toThrow(
    "Could not remove",
  );
  expect(browser.extensions).toHaveLength(1);
  browser.calls.removalFails = false;
  await installation.remove(browser.api);
  expect(browser.extensions).toEqual([]);
});

test("an explicitly suspended original is allowed only at its exact disabled path and never removed", async () => {
  const original = {
    id: "original",
    name: "DataFog",
    path: "/current/repo/dist",
    enabled: false,
  };
  const browser = installer([original]);
  const installation = new TestExtensionInstallation(testPath);
  await installation.load(browser.api, true, {
    id: original.id,
    path: original.path,
  });
  await installation.remove(browser.api);
  expect(browser.extensions).toEqual([original]);
  expect(browser.removed).toEqual(["test-id"]);
  for (const candidate of [
    { ...original, enabled: true },
    { ...original, path: "/personal/vault" },
  ]) {
    const changed = installer([candidate]);
    await expect(
      new TestExtensionInstallation(testPath).load(changed.api, true, {
        id: original.id,
        path: original.path,
      }),
    ).rejects.toThrow("already has datafog");
    expect(changed.calls.load).toBe(0);
  }
});

test("Chrome's canonical path still identifies a test installed through a symlink after startup fails", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "datafog-installation-"));
  const target = path.join(directory, "real");
  const alias = path.join(directory, "alias");
  try {
    await mkdir(target);
    await symlink(target, alias, "dir");
    const browser = installer();
    const load = browser.api.load.bind(browser.api);
    browser.api.load = async (extensionPath) => {
      const id = await load(extensionPath);
      browser.extensions.find((extension) => extension.id === id)!.path =
        await realpath(extensionPath);
      throw new Error("Worker startup failed after install");
    };
    const installation = new TestExtensionInstallation(alias);
    await expect(installation.load(browser.api, true)).rejects.toThrow(
      "Worker startup failed",
    );
    // Cleanup retains the verified identity even if an outer failure removed
    // the copied directory before Chrome released the registered extension.
    await rm(target, { recursive: true });
    await installation.remove(browser.api);
    expect(browser.removed).toEqual(["test-id"]);
    expect(browser.extensions).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
