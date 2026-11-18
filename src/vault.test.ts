/**
 * The vault host, with Core's real Workspace in place of the adapter's and a
 * stand-in for FogVault, which needs a browser Worker and IndexedDB.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Workspace, type PreparedWorkspaceChange } from "@datafog/wasm";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

import { ready, scanRules, workspaceFindings } from "./detect";
import { REMEMBER_MS, type DeviceRecord, type Devices } from "./device";
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
let devices: FakeDevices;
let now: number;
/** Holds finding values back until resolved, as a slow model would. */
let scanning: Promise<void>;
/** Device identities the stand-in vault holds, base64, and its profile. */
let slots: string[];
let profile: "password" | "password-or-device";

/** Device keys in memory, as DeviceKeys keeps them in IndexedDB. */
class FakeDevices implements Devices {
  records: DeviceRecord[] = [];
  pausedNow = false;
  private next = 0;
  async load(): Promise<void> {}
  providers(): never[] {
    return [];
  }
  active(at: number): DeviceRecord | null {
    return this.pausedNow ? null : this.current(at);
  }
  rememberedUntil(at: number): number | null {
    const record = this.current(at);
    return record ? record.rememberedAt + REMEMBER_MS : null;
  }
  async prune(at: number): Promise<void> {
    if (this.records.some((record) => record.key) && !this.current(at))
      await this.forget();
  }
  async create(at: number) {
    const keyId = btoa(String.fromCharCode(++this.next));
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    this.records.push({ keyId, key, rememberedAt: at });
    return {
      providerId: new Uint8Array(16),
      keyId: Uint8Array.from(atob(keyId), (char) => char.charCodeAt(0)),
      deviceBound: true as const,
      nonexportable: true as const,
    };
  }
  async forget(): Promise<void> {
    this.records = this.records.map((record) => ({ ...record, key: null }));
  }
  paused(): boolean {
    return this.pausedNow;
  }
  async setPaused(paused: boolean): Promise<void> {
    this.pausedNow = paused;
  }
  async clear(): Promise<void> {
    this.records = [];
    this.pausedNow = false;
  }
  private current(at: number): DeviceRecord | null {
    return (
      this.records.find(
        (record) => record.key && at - record.rememberedAt < REMEMBER_MS,
      ) ?? null
    );
  }
}

/**
 * Make an owner for the shared workspace, saving each approved plan.
 *
 * @returns The owner.
 */
function makeOwner(): FakeOwner {
  let pending: PreparedWorkspaceChange | null = null;
  /**
   * Hand out a change as the adapter does, one at a time.
   *
   * @param change Core's prepared change.
   * @returns The adapter's plan for it.
   */
  const wrap = (change: PreparedWorkspaceChange) => {
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
  };
  const made: FakeOwner = {
    closed: false,
    discards: 0,
    failNextSave: null,
    prepare: (text, findings, operationId) =>
      wrap(workspace.prepare(text, findings, operationId)),
    prepareReview: (inputs, operationId) =>
      wrap(workspace.prepareReview(inputs, operationId)),
    preparePolicyChanges: (edits, operationId) =>
      wrap(workspace.preparePolicyChanges(edits, operationId)),
    policy: () => workspace.policy(),
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
  return (await host.create("correct horse", null, false)).routing;
}

beforeAll(async () => {
  const wasm = readFileSync(
    "node_modules/@datafog/wasm/dist/datafog_wasm_bg.wasm",
  );
  globalThis.fetch = async () =>
    new Response(wasm, { headers: { "Content-Type": "application/wasm" } });
  await ready();
});

/**
 * A device identity's base64 key ID.
 *
 * @param identity The identity.
 * @returns Its key ID.
 */
function keyIdOf(identity: { keyId: Uint8Array }): string {
  return btoa(String.fromCharCode(...identity.keyId));
}

beforeEach(() => {
  devices = new FakeDevices();
  now = 1_000_000;
  slots = [];
  profile = "password-or-device";
  vault = {
    create: vi.fn(async (_name, _password, options) => {
      slots = (options?.devices ?? []).map(keyIdOf);
      return { created: true as const, receipt: RECEIPT };
    }),
    describeAccess: vi.fn(async () => ({
      profile,
      recovery: false,
      rootEpoch: 0n,
      devices: slots.map((keyId) => ({
        slotId: new Uint8Array(16).fill(keyId.charCodeAt(0)),
        identity: {
          providerId: new Uint8Array(16),
          keyId: Uint8Array.from(atob(keyId), (char) => char.charCodeAt(0)),
          deviceBound: true as const,
          nonexportable: true as const,
        },
      })),
    })),
    unlockDevice: vi.fn(async () => ({
      unlocked: true as const,
      receipt: RECEIPT,
    })),
    enrollDevice: vi.fn(async (_source, identity) => {
      slots.push(keyIdOf(identity));
      return { receipt: RECEIPT, key_effect: "Preserved" as const };
    }),
    protectAccess: vi.fn(async (_source, target) => {
      profile = "password-or-device";
      slots = target.devices.map(keyIdOf);
      return {
        receipt: RECEIPT,
        key_effect: "FreshRootAndContentKeys" as const,
      };
    }),
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
  scanning = Promise.resolve();
  notify = vi.fn<() => void>();
  deleteStore = vi.fn(async () => {});
  host = new VaultHost({
    newVault: () => vault,
    devices,
    now: () => now,
    createOwner: async (_vault, route) => {
      workspace = Workspace.create(route.namespace, randomBytes(16));
      owner = makeOwner();
      return owner;
    },
    openOwner: async () => {
      owner = makeOwner();
      return owner;
    },
    findings: async (text, settings) => {
      await scanning;
      return workspaceFindings(text, settings, scanRules);
    },
    randomId: () => randomBytes(16),
    deleteStore,
    notify,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

test("creates an unlocked vault without a recovery key", async () => {
  const created = await host.create("correct horse", null, false);

  expect(vi.mocked(vault.create)).toHaveBeenCalledWith(
    "datafog",
    "correct horse",
    expect.objectContaining({
      recovery: false,
      profile: "password-or-device",
    }),
  );
  expect(created.status.state).toBe("unlocked");
  expect(atob(created.routing.namespace)).toHaveLength(16);
});

test("won't create a second vault", async () => {
  const routing = await create();

  await expect(host.create("another", routing, false)).rejects.toMatchObject({
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

  const saved = await host.approve(DEFAULT_SETTINGS);

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
  await host.approve(DEFAULT_SETTINGS);

  await host.pseudonymize("Write to jane@example.com", 7, DEFAULT_SETTINGS);

  expect(host.status(routing).review).toEqual([
    { entityType: "EMAIL", original: "jane@example.com", marker: first },
  ]);
});

test("pseudonymizes one reviewed value on its own", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  const [first] = host.status(routing).review!;

  const saved = await host.markSensitive(1, DEFAULT_SETTINGS);

  const [edit] = saved.response.edits;
  expect(saved).toMatchObject({ tabId: 7, text: TEXT, remaining: 1 });
  expect(saved.response.edits).toEqual([
    {
      start: 24,
      end: 38,
      replacement: expect.stringMatching(/^\[\[EMAIL_[0-9A-Z]{6}\]\]$/),
    },
  ]);
  expect(saved.response.text).toBe(
    `Ask jane@example.com or ${edit.replacement} today`,
  );
  expect(host.status(routing).review).toBeNull();

  // The value left is reviewed again in the changed chat box, and the one
  // saved keeps its marker
  await host.pseudonymize(saved.response.text, 7, DEFAULT_SETTINGS);
  expect(host.status(routing).review?.map((item) => item.original)).toEqual([
    first.original,
  ]);
  host.cancel();
  await host.pseudonymize("Write to al@example.org", 7, DEFAULT_SETTINGS);
  expect(host.status(routing).review?.[0].marker).toBe(edit.replacement);
});

test("drops the review when what's checked for changes before marking", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);

  const changed = { ...DEFAULT_SETTINGS, denylist: ["today"] };
  await expect(host.markSensitive(0, changed)).rejects.toMatchObject({
    code: "settings_changed",
  });
  expect(host.status(routing)).toMatchObject({
    review: null,
    reviewError: "settings_changed",
  });
});

test("remembers a value as not sensitive, and leaves it out of reviews", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);

  await host.markNotSensitive(0);

  expect(host.status(routing)).toMatchObject({
    review: [{ entityType: "EMAIL", original: "al@example.org" }],
    notSensitive: [{ entityType: "EMAIL", value: "jane@example.com" }],
  });
  host.cancel();
  await host.pseudonymize("Write to JANE@example.com", 7, DEFAULT_SETTINGS);
  expect(host.status(routing)).toMatchObject({
    review: null,
    reviewError: "nothing_found",
  });
});

test("replaces a value again once its choice is removed", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  await host.markNotSensitive(0);

  await host.clearChoice({ entityType: "EMAIL", value: "jane@example.com" });

  expect(host.status(routing).notSensitive).toEqual([]);
  expect(host.status(routing).review?.map((item) => item.original)).toEqual([
    "jane@example.com",
    "al@example.org",
  ]);
});

test("locks when a choice can't be saved, as for a review", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  owner.failNextSave = Object.assign(new Error(), { code: "storage_failed" });

  await expect(host.markNotSensitive(0)).rejects.toMatchObject({
    code: "storage_failed",
  });
  expect(host.status(routing)).toMatchObject({
    state: "locked",
    review: null,
    waiting: false,
    notSensitive: [],
  });
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

  await expect(host.unlock("wrong", routing, false)).rejects.toMatchObject({
    code: "Integrity",
  });
  expect(host.status(routing).state).toBe("locked");

  const status = await host.unlock("correct horse", routing, false);
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

/**
 * Hold finding values back until the returned function is called.
 *
 * @returns Releases them.
 */
function holdScans(): () => void {
  const held: { release?: () => void } = {};
  scanning = new Promise((resolve) => {
    held.release = resolve;
  });
  return () => held.release?.();
}

test("drops a review when what's checked for changes before approval", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);

  const changed = { ...DEFAULT_SETTINGS, allowlist: ["jane@example.com"] };
  await expect(host.approve(changed)).rejects.toMatchObject({
    code: "settings_changed",
  });
  expect(owner.discards).toBe(1);
  expect(host.status(routing)).toMatchObject({
    review: null,
    reviewError: "settings_changed",
  });
});

test("drops a review cancelled while its values are found", async () => {
  const routing = await create();
  const release = holdScans();
  const pending = host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);

  host.cancel();
  release();
  await pending;
  expect(host.status(routing).review).toBeNull();
  expect(host.status(routing).waiting).toBe(false);
});

test("keeps Pseudonymize waiting if the vault locks meanwhile", async () => {
  const routing = await create();
  const release = holdScans();
  const pending = host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);

  await host.lock(routing);
  release();
  await pending;
  expect(host.status(routing)).toMatchObject({
    state: "locked",
    waiting: true,
    review: null,
  });
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

test("stays unlocked without use while the device is remembered", async () => {
  vi.useFakeTimers();
  const routing = (await host.create("correct horse", null, true)).routing;

  await vi.advanceTimersByTimeAsync(IDLE_LOCK_MS * 4);
  expect(host.status(routing).state).toBe("unlocked");

  // Locks once the 30 days are up
  now += REMEMBER_MS;
  await vi.advanceTimersByTimeAsync(REMEMBER_MS);
  expect(host.status(routing).state).toBe("locked");
});

test("locks after idling again once the device is forgotten", async () => {
  vi.useFakeTimers();
  const routing = (await host.create("correct horse", null, true)).routing;

  await host.forgetDevice(routing);
  await vi.advanceTimersByTimeAsync(IDLE_LOCK_MS);
  expect(host.status(routing).state).toBe("locked");
});

test("locks after a lost save, and settles it at the next unlock", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  const requestId = new Uint8Array([9]);
  owner.failNextSave = Object.assign(new Error(), {
    code: "OutcomeUnknown",
    requestId,
  });

  await expect(host.approve(DEFAULT_SETTINGS)).rejects.toMatchObject({
    code: "OutcomeUnknown",
  });
  expect(host.status(routing)).toMatchObject({
    state: "locked",
    reviewError: "OutcomeUnknown",
  });
  expect(vi.mocked(vault.lock)).toHaveBeenCalled();

  await host.unlock("correct horse", routing, false);
  expect(vi.mocked(vault.reconcileLatest)).toHaveBeenCalledWith(requestId);
});

test("deletes the vault without its password", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);

  const status = await host.deleteVault(routing);

  expect(vi.mocked(vault.unlock)).not.toHaveBeenCalled();
  expect(vi.mocked(vault.close)).toHaveBeenCalled();
  expect(deleteStore).toHaveBeenCalledWith("datafog");
  expect(status).toMatchObject({ state: "none", review: null });
  expect(owner.closed).toBe(true);
});

test("deletes a vault that was never unlocked", async () => {
  const routing = { recordId: "AA==", namespace: "AA==" };
  expect((await host.deleteVault(routing)).state).toBe("none");
  expect(deleteStore).toHaveBeenCalledWith("datafog");
});

test("restores the markers it issued", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  const { response } = await host.approve(DEFAULT_SETTINGS);

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
  const { response } = await host.approve(DEFAULT_SETTINGS);
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

test("creates every vault ready for a device, forgetting it unless asked", async () => {
  const routing = await create();

  expect(slots).toHaveLength(1);
  expect(host.status(routing).rememberedUntil).toBeNull();
  await host.lock(routing);
  await host.unlockWithDevice(routing);
  expect(host.status(routing).state).toBe("locked");
});

test("unlocks with a remembered device on use, for 30 days", async () => {
  const { routing } = await host.create("correct horse", null, true);
  expect(host.status(routing).rememberedUntil).toBe(now + REMEMBER_MS);
  await host.lock(routing);

  await host.unlockWithDevice(routing);
  expect(vi.mocked(vault.unlockDevice)).toHaveBeenCalledWith(
    new Uint8Array(16).fill(slots[0].charCodeAt(0)),
  );
  expect(host.status(routing).state).toBe("unlocked");
  expect(notify).toHaveBeenCalled();

  await host.lock(routing);
  now += REMEMBER_MS;
  await host.unlockWithDevice(routing);
  expect(host.status(routing)).toMatchObject({
    state: "locked",
    rememberedUntil: null,
  });
  expect(devices.records.every((record) => record.key === null)).toBe(true);
});

test("asks for the password after a manual lock", async () => {
  const { routing } = await host.create("correct horse", null, true);

  await host.lock(routing, true);
  await host.unlockWithDevice(routing);
  expect(host.status(routing).state).toBe("locked");
  expect(vi.mocked(vault.unlockDevice)).not.toHaveBeenCalled();

  await host.unlock("correct horse", routing, false);
  await host.lock(routing);
  await host.unlockWithDevice(routing);
  expect(host.status(routing).state).toBe("unlocked");
});

test("remembers the device at unlock, keeping the vault's keys", async () => {
  const routing = await create();
  await host.lock(routing);

  const unlocked = await host.unlock("correct horse", routing, true);

  expect(vi.mocked(vault.enrollDevice)).toHaveBeenCalled();
  expect(vi.mocked(vault.protectAccess)).not.toHaveBeenCalled();
  expect(unlocked.rememberedUntil).toBe(now + REMEMBER_MS);
});

test("gives an older password-only vault new keys to remember a device", async () => {
  const routing = await create();
  await host.lock(routing);
  profile = "password";

  const unlocked = await host.unlock("correct horse", routing, true);

  expect(vi.mocked(vault.protectAccess)).toHaveBeenCalledWith(
    { kind: "password", password: "correct horse" },
    expect.objectContaining({ profile: "password-or-device", recovery: false }),
  );
  expect(unlocked.state).toBe("unlocked");
});

test("forgets the device, and stays locked when its key fails", async () => {
  const { routing } = await host.create("correct horse", null, true);

  expect((await host.forgetDevice(routing)).rememberedUntil).toBeNull();

  await host.unlock("correct horse", routing, true);
  await host.lock(routing);
  vi.mocked(vault.unlockDevice).mockRejectedValueOnce(
    Object.assign(new Error(), { code: "ProviderFailure" }),
  );
  await host.unlockWithDevice(routing);
  expect(host.status(routing)).toMatchObject({
    state: "locked",
    rememberedUntil: null,
  });
});

test("automatic access preserves a failing existing key and never creates a replacement", async () => {
  const { routing } = await host.create("correct horse", null, true);
  await host.lock(routing);
  const keys = devices.records.map((record) => record.key);
  vi.mocked(vault.unlockDevice).mockRejectedValueOnce(
    Object.assign(new Error(), { code: "ProviderFailure" }),
  );
  await expect(host.automaticAccess(routing)).rejects.toMatchObject({
    code: "vault_access_failed",
  });
  expect(devices.records.map((record) => record.key)).toEqual(keys);
  expect(vault.create).toHaveBeenCalledTimes(1);
  expect(host.status(routing).state).toBe("locked");
  await host.automaticAccess(routing);
  expect(host.status(routing).state).toBe("unlocked");
});

test("automatic access reconciles an uncertain replacement before another edit", async () => {
  const { routing } = await host.create("correct horse", null, true);
  await host.automaticAccess(routing);
  const requestId = new Uint8Array([8]);
  owner.failNextSave = Object.assign(new Error(), {
    code: "OutcomeUnknown",
    requestId,
  });
  await expect(host.replace(TEXT, 7, DEFAULT_SETTINGS)).rejects.toMatchObject({
    code: "OutcomeUnknown",
  });
  await host.automaticAccess(routing);
  expect(vault.reconcileLatest).toHaveBeenCalledWith(requestId);
  const result = await host.replace(TEXT, 7, DEFAULT_SETTINGS);
  expect(result.saved).toBe(true);
  expect(host.restore(result.text).text).toBe(TEXT);
});

test("failed database deletion retains keys and supports cleanup retry", async () => {
  const { routing } = await host.create("correct horse", null, true);
  const keys = devices.records.map((record) => record.key);
  deleteStore.mockRejectedValueOnce(
    Object.assign(new Error(), { code: "delete_failed" }),
  );
  await expect(host.deleteVault(routing)).rejects.toMatchObject({
    code: "delete_failed",
  });
  expect(devices.records.map((record) => record.key)).toEqual(keys);
  expect((await host.deleteVault(routing)).state).toBe("none");
  expect(devices.records).toEqual([]);
});

test("automatic access does not idle-lock or require a second approval for replacement", async () => {
  vi.useFakeTimers();
  const { routing } = await host.create("correct horse", null, true);
  await host.automaticAccess(routing);
  await vi.advanceTimersByTimeAsync(IDLE_LOCK_MS * 2);
  expect(host.status(routing).state).toBe("unlocked");
  const result = await host.replace(TEXT, 7, DEFAULT_SETTINGS);
  expect(result.saved).toBe(true);
  expect(host.restore(result.text).text).toBe(TEXT);
});

test("partial key cleanup retains its deletion stage and retries without deleting twice", async () => {
  const { routing } = await host.create("correct horse", null, true);
  vi.spyOn(devices, "clear").mockRejectedValueOnce(
    Object.assign(new Error(), { code: "device_storage" }),
  );
  await expect(host.deleteVault(routing)).rejects.toMatchObject({
    code: "device_storage",
  });
  expect(host.status(routing).deletion).toBe("partial-failure");
  expect((await host.deleteVault(routing)).deletion).toBe("complete");
  expect(deleteStore).toHaveBeenCalledTimes(1);
  expect(devices.records).toEqual([]);
});

test("Replace commits exactly the reserved preview markers without reallocating", async () => {
  const { routing } = await host.create("correct horse", null, true);
  await host.automaticAccess(routing);
  const preview = await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy-a");
  expect(preview.findings).toHaveLength(2);
  const saved = await host.replace(
    TEXT,
    7,
    DEFAULT_SETTINGS,
    preview.previewId,
    "policy-a",
  );
  for (const item of preview.findings)
    expect(saved.text).toContain(item.marker);
  expect(host.restore(saved.text).text).toBe(TEXT);
});

test("another tab invalidates a reservation instead of silently applying different markers", async () => {
  await host.create("correct horse", null, true);
  const first = await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy-a");
  await host.preview("other@example.com", DEFAULT_SETTINGS, 8, 1, "policy-a");
  await expect(
    host.replace(TEXT, 7, DEFAULT_SETTINGS, first.previewId, "policy-a"),
  ).rejects.toMatchObject({ code: "preview_expired" });
  expect(host.restore(first.findings[0].marker).restored).toBe(0);
  const refreshed = await host.preview(
    TEXT,
    DEFAULT_SETTINGS,
    7,
    2,
    "policy-a",
  );
  const saved = await host.replace(
    TEXT,
    7,
    DEFAULT_SETTINGS,
    refreshed.previewId,
    "policy-a",
  );
  expect(saved.text).toContain(refreshed.findings[0].marker);
});

test("changed policy or draft cannot consume an old preview reservation", async () => {
  await host.create("correct horse", null, true);
  const preview = await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy-a");
  await expect(
    host.replace(TEXT, 7, DEFAULT_SETTINGS, preview.previewId, "policy-b"),
  ).rejects.toMatchObject({ code: "preview_expired" });
  await expect(
    host.replace(
      TEXT + " edited",
      7,
      DEFAULT_SETTINGS,
      preview.previewId,
      "policy-a",
    ),
  ).rejects.toMatchObject({ code: "preview_expired" });
  expect(host.restore(preview.findings[0].marker).restored).toBe(0);
});
