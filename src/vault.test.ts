/**
 * The vault host, with Core's real Workspace in place of the adapter's and a
 * stand-in for FogVault, which needs a browser Worker and IndexedDB.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Workspace, type PreparedWorkspaceChange } from "@datafog/wasm";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

import { ready, workspaceFindings } from "./detect";
import type { VaultRouting } from "./messages";
import { DEFAULT_SETTINGS } from "./settings";
import { IDLE_LOCK_MS, VaultHost, type Owner, type Vault } from "./vault";

const TEXT = "Ask jane@example.com or al@example.org today";
const RECEIPT = {
  generation: 1n,
  request_id: new Uint8Array(16),
  head_digest: new Uint8Array(32),
};

/** A stand-in owner over one real workspace, as the adapter would be. */
interface FakeOwner extends Owner {
  closed: boolean;
  discards: number;
  failNextSave: unknown;
}

let workspace: Workspace;
let owner: FakeOwner;
let vault: Vault;
let notify: ReturnType<typeof vi.fn<() => void>>;
let deleteStore: ReturnType<typeof vi.fn<(name: string) => Promise<void>>>;
let host: VaultHost;
let recoveryKey: Uint8Array;

/**
 * Make an owner for the shared workspace, saving each approved plan.
 *
 * @returns The owner.
 */
function makeOwner(): FakeOwner {
  let pending: PreparedWorkspaceChange | null = null;
  const made: FakeOwner = {
    closed: false,
    discards: 0,
    failNextSave: null,
    prepareReview: (inputs, operationId) => {
      const change = workspace.prepareReview(inputs, operationId);
      pending = change;
      return {
        preview: () => change.preview(),
        previews: () => change.previews(),
        heads: () => change.heads(),
        snapshotFormat: () => change.snapshotFormat(),
        policyPreview: () => change.policyPreview(),
        sendIntents: () => change.sendIntents(),
        discard: () => {
          made.discards++;
          change.discard();
        },
      };
    },
    commit: async () => {
      if (made.failNextSave) {
        made.closed = true;
        throw made.failNextSave;
      }
      const change = pending!;
      const previews = change.previews();
      const { expectedHead, candidateHead } = change.heads();
      workspace.activateSaved(change, expectedHead, candidateHead);
      return {
        previews,
        head: candidateHead,
        recordRevision: 1n,
        receipt: RECEIPT,
      };
    },
    lock: async () => {
      made.closed = true;
      return { locked: true };
    },
    restoreReport: (text) => workspace.restoreReport(text),
  };
  return made;
}

/**
 * Create the vault with a password, as the side panel would.
 *
 * @returns The new routing.
 */
async function create(): Promise<VaultRouting> {
  return (await host.create("correct horse", null)).routing;
}

beforeAll(async () => {
  const wasm = readFileSync(
    "node_modules/@datafog/wasm/dist/datafog_wasm_bg.wasm",
  );
  globalThis.fetch = async () =>
    new Response(wasm, { headers: { "Content-Type": "application/wasm" } });
  await ready();
});

beforeEach(() => {
  recoveryKey = new Uint8Array([1, 2, 3]);
  vault = {
    create: vi.fn(async () => ({
      created: true as const,
      receipt: RECEIPT,
      recovery_key: recoveryKey,
    })),
    open: vi.fn(async () => ({ opened: true as const })),
    unlock: vi.fn(async (password: string) => {
      if (password !== "correct horse")
        throw Object.assign(new Error(), { code: "Integrity" });
      return { unlocked: true as const, receipt: RECEIPT };
    }),
    lock: vi.fn(async () => ({ locked: true as const })),
    close: vi.fn(async () => ({ closed: true as const })),
    reconcileLatest: vi.fn(async () => ({
      reconciled: true as const,
      receipt: RECEIPT,
    })),
  };
  notify = vi.fn<() => void>();
  deleteStore = vi.fn(async () => {});
  host = new VaultHost({
    newVault: () => vault,
    createOwner: async (_vault, route) => {
      workspace = Workspace.create(route.namespace, randomBytes(16));
      owner = makeOwner();
      return owner;
    },
    openOwner: async () => {
      owner = makeOwner();
      return owner;
    },
    findings: workspaceFindings,
    randomId: () => randomBytes(16),
    deleteStore,
    notify,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

test("creates an unlocked vault, handing over the recovery key once", async () => {
  const created = await host.create("correct horse", null);

  expect(vi.mocked(vault.create)).toHaveBeenCalledWith(
    "datafog",
    "correct horse",
    {
      recovery: true,
    },
  );
  expect(created.recoveryKey).toBe("AQID");
  expect(recoveryKey).toEqual(new Uint8Array(3));
  expect(created.status.state).toBe("unlocked");
  expect(atob(created.routing.namespace)).toHaveLength(16);
});

test("won't create a second vault", async () => {
  const routing = await create();

  await expect(host.create("another", routing)).rejects.toMatchObject({
    code: "vault_exists",
  });
});

test("prepares a review of each value and its marker", async () => {
  const routing = await create();

  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);

  const { review } = host.status(routing);
  expect(review?.map((item) => item.original)).toEqual([
    "jane@example.com",
    "al@example.org",
  ]);
  for (const item of review ?? []) {
    expect(item.marker).toMatch(/^\[\[EMAIL_[0-9A-Z]{6}\]\]$/);
  }
  expect(host.source()).toEqual({ tabId: 7, text: TEXT });
  expect(notify).toHaveBeenCalled();
});

test("saves an approved review and says how to edit the chat box", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  const markers = host.status(routing).review!.map((item) => item.marker);

  const saved = await host.approve();

  expect(saved.tabId).toBe(7);
  expect(saved.text).toBe(TEXT);
  expect(saved.response.text).toBe(`Ask ${markers[0]} or ${markers[1]} today`);
  expect(saved.response.edits).toEqual([
    { start: 4, end: 20, replacement: markers[0] },
    { start: 24, end: 38, replacement: markers[1] },
  ]);
  expect(host.status(routing).review).toBeNull();
});

test("gives a value the same marker the next time", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  const first = host.status(routing).review![0].marker;
  await host.approve();

  await host.pseudonymize("Write to jane@example.com", 7, DEFAULT_SETTINGS);

  expect(host.status(routing).review).toEqual([
    { original: "jane@example.com", marker: first },
  ]);
});

test("says when there's nothing to pseudonymize", async () => {
  const routing = await create();

  await host.pseudonymize("nothing to see here", 7, DEFAULT_SETTINGS);

  expect(host.status(routing)).toMatchObject({
    review: null,
    reviewError: "nothing_found",
  });
});

test("waits for an unlock, then prepares the review", async () => {
  const routing = await create();
  await host.lock(routing);

  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  expect(host.status(routing)).toMatchObject({
    state: "locked",
    waiting: true,
  });

  await expect(host.unlock("wrong", routing)).rejects.toMatchObject({
    code: "Integrity",
  });
  expect(host.status(routing).state).toBe("locked");

  const status = await host.unlock("correct horse", routing);
  expect(status.state).toBe("unlocked");
  expect(status.waiting).toBe(false);
  expect(status.review).toHaveLength(2);
});

test("discards the plan when the review is cancelled or replaced", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);

  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  expect(owner.discards).toBe(1);

  host.cancel();
  expect(owner.discards).toBe(2);
  expect(host.status(routing).review).toBeNull();
});

test("locks after 15 minutes without use", async () => {
  vi.useFakeTimers();
  const routing = await create();

  await vi.advanceTimersByTimeAsync(IDLE_LOCK_MS - 1);
  expect(host.status(routing).state).toBe("unlocked");

  await vi.advanceTimersByTimeAsync(1);
  expect(host.status(routing).state).toBe("locked");
  expect(owner.closed).toBe(true);
  expect(notify).toHaveBeenCalled();
});

test("locks after a lost save, and settles it at the next unlock", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  const requestId = new Uint8Array([9]);
  owner.failNextSave = Object.assign(new Error(), {
    code: "OutcomeUnknown",
    requestId,
  });

  await expect(host.approve()).rejects.toMatchObject({
    code: "OutcomeUnknown",
  });
  expect(host.status(routing)).toMatchObject({
    state: "locked",
    reviewError: "OutcomeUnknown",
  });
  expect(vi.mocked(vault.lock)).toHaveBeenCalled();

  await host.unlock("correct horse", routing);
  expect(vi.mocked(vault.reconcileLatest)).toHaveBeenCalledWith(requestId);
});

test("resets the vault only with the right password", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);

  await expect(host.reset("wrong", routing)).rejects.toMatchObject({
    code: "Integrity",
  });
  expect(deleteStore).not.toHaveBeenCalled();
  expect(host.status(routing)).toMatchObject({
    state: "locked",
    review: null,
  });

  const status = await host.reset("correct horse", routing);

  expect(vi.mocked(vault.close)).toHaveBeenCalled();
  expect(deleteStore).toHaveBeenCalledWith("datafog");
  expect(status.state).toBe("none");
  expect(owner.closed).toBe(true);
});

test("restores the markers it issued", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  const { response } = await host.approve();

  const restored = host.restore(`Sure: ${response.text}`);

  const [first, second] = response.edits.map((edit) => edit.replacement);
  expect(restored).toEqual({
    text: `Sure: ${TEXT}`,
    restored: 2,
    unrestored: 0,
    values: [
      { marker: first, original: "jane@example.com" },
      { marker: second, original: "al@example.org" },
    ],
  });
  expect(host.status(routing).state).toBe("unlocked");
});

test("leaves markers it can't restore as they are", async () => {
  await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  const { response } = await host.approve();
  const [first] = response.edits;

  const restored = host.restore(
    `${first.replacement} and [[EMAIL_ZZZZZZ]] and ${first.replacement}`,
  );

  expect(restored).toEqual({
    text: "jane@example.com and [[EMAIL_ZZZZZZ]] and jane@example.com",
    restored: 2,
    unrestored: 1,
    values: [{ marker: first.replacement, original: "jane@example.com" }],
  });
});

test("won't restore while locked", async () => {
  const routing = await create();
  await host.lock(routing);

  expect(() => host.restore("[[EMAIL_7KQ4ZM]]")).toThrow(
    expect.objectContaining({ code: "vault_locked" }),
  );
});
