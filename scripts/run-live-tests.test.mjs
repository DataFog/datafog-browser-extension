import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runNode, withIsolatedLiveBuild } from "./run-live-tests.mjs";

it("services parent events while the live-test child is running", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "datafog-child-events-"));
  const signal = path.join(directory, "parent-event");
  // Like a Chrome target awaiting this parent's CDP response, the child cannot
  // finish until a parent event runs. spawnSync would deadlock until timeout.
  const event = new Promise((resolve, reject) =>
    setTimeout(() => {
      writeFile(signal, "ready").then(resolve, reject);
    }, 20),
  );
  try {
    await expect(
      runNode(
        [
          "-e",
          `
      const fs = require('node:fs');
      const interval = setInterval(() => {
        if (fs.existsSync(process.env.DATAFOG_PARENT_EVENT)) {
          clearInterval(interval); clearTimeout(deadline);
        }
      }, 10);
      const deadline = setTimeout(() => process.exit(2), 1000);
    `,
        ],
        { ...process.env, DATAFOG_PARENT_EVENT: signal },
      ),
    ).resolves.toBeUndefined();
    await event;
  } finally {
    await event;
    await rm(directory, { recursive: true, force: true });
  }
});

const installedManifest = () =>
  readFile("dist/manifest.json").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

it("builds live fixtures in owned temporary output and preserves installed output", async () => {
  const installed = await installedManifest();
  let owned;
  await withIsolatedLiveBuild(process.env, async (env) => {
    owned = env.DATAFOG_TEST_BUILD_ROOT;
    expect(path.isAbsolute(owned)).toBe(true);
    expect(owned).not.toBe(process.cwd());
    expect(
      JSON.parse(await readFile(path.join(owned, "dist/manifest.json"), "utf8"))
        .name,
    ).toBe("datafog");
    expect(await installedManifest()).toEqual(installed);
    const inode = (await stat(path.join(owned, "dist"))).ino;
    await runNode(["build.mjs", "--output-root", owned]);
    expect((await stat(path.join(owned, "dist"))).ino).toBe(inode);
  });
  await expect(stat(owned)).rejects.toMatchObject({ code: "ENOENT" });
});

it("removes only its temporary build after failed compilation or failed tests", async () => {
  let owned;
  await expect(
    withIsolatedLiveBuild(
      process.env,
      async () => {},
      async (args) => {
        owned = args[2];
        throw new Error("compile failed");
      },
    ),
  ).rejects.toThrow("compile failed");
  await expect(stat(owned)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    withIsolatedLiveBuild(
      process.env,
      async (env) => {
        owned = env.DATAFOG_TEST_BUILD_ROOT;
        throw new Error("test failed");
      },
      async () => {},
    ),
  ).rejects.toThrow("test failed");
  await expect(stat(owned)).rejects.toMatchObject({ code: "ENOENT" });
});
