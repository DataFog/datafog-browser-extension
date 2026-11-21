import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runNode } from "./run-live-tests.mjs";

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
