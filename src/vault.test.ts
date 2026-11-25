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
    prepareBatch: (inputs, operationId) =>
      wrap(workspace.prepareBatch(inputs, operationId)),
    prepare: (text, findings, operationId) =>
      wrap(workspace.prepare(text, findings, operationId)),
    prepareForget: (codes, operationId) =>
      wrap(workspace.prepareForget(codes, operationId)),
    prepareReview: (inputs, operationId) =>
      wrap(workspace.prepareReview(inputs, operationId)),
    preparePolicyChanges: (edits, operationId) =>
      wrap(workspace.preparePolicyChanges(edits, operationId)),
    review: (input) => workspace.review(input),
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
    open: vi.fn(async () => ({ opened: true as const })),
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
    {
      entityType: "EMAIL",
      original: "jane@example.com",
      marker: first,
      start: 9,
      end: 25,
    },
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

test("automatic access prepares a waiting review without a password", async () => {
  const { routing } = await host.create("correct horse", null, true);
  await host.lock(routing);
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);
  expect(host.status(routing)).toMatchObject({
    state: "locked",
    waiting: true,
  });
  await host.automaticAccess(routing);
  expect(host.status(routing)).toMatchObject({
    state: "unlocked",
    waiting: false,
  });
  expect(host.status(routing).review).toHaveLength(2);
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

test("locks after a lost save, and settles it with automatic access", async () => {
  const { routing } = await host.create("correct horse", null, true);
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

  await host.automaticAccess(routing);
  expect(vi.mocked(vault.reconcileLatest)).toHaveBeenCalledWith(requestId);
});

test("deletes the vault without its password", async () => {
  const routing = await create();
  await host.pseudonymize(TEXT, 7, DEFAULT_SETTINGS);

  const status = await host.deleteVault(routing);

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

test("selection keeps only one repeated occurrence and commits refreshed exact tokens", async () => {
  await host.create("correct horse", null, true);
  const text = "🙂 jane@example.com and jane@example.com";
  const first = await host.preview(text, DEFAULT_SETTINGS, 7, 1, "policy");
  const place = {
    start: first.findings[0].start!,
    end: first.findings[0].end!,
  };
  const selected = await host.select(
    text,
    DEFAULT_SETTINGS,
    7,
    first.previewId!,
    "policy",
    [place],
  );
  expect(selected.previewId).not.toBe(first.previewId);
  expect(selected.findings[0]).toMatchObject({ kept: true, marker: "" });
  expect(selected.findings[1].marker).toMatch(/^\[\[EMAIL_/);
  await expect(
    host.replace(text, 7, DEFAULT_SETTINGS, first.previewId, "policy"),
  ).rejects.toMatchObject({ code: "preview_expired" });
  const saved = await host.replace(
    text,
    7,
    DEFAULT_SETTINGS,
    selected.previewId,
    "policy",
  );
  expect(saved.text).toBe(
    "🙂 jane@example.com and " + selected.findings[1].marker,
  );
  expect(saved.edits).toHaveLength(1);
  expect(host.restore(saved.text).text).toBe(text);
});

test("all-kept reservations cannot save and can select again after a rescan", async () => {
  await host.create("correct horse", null, true);
  const first = await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy");
  const keep = first.findings.map((item) => ({
    start: item.start!,
    end: item.end!,
  }));
  const none = await host.select(
    TEXT,
    DEFAULT_SETTINGS,
    7,
    first.previewId!,
    "policy",
    keep,
  );
  await expect(
    host.replace(TEXT, 7, DEFAULT_SETTINGS, none.previewId, "policy"),
  ).rejects.toMatchObject({ code: "nothing_found" });
  const rescanned = await host.preview(
    TEXT,
    DEFAULT_SETTINGS,
    7,
    2,
    "policy",
    keep,
  );
  expect(rescanned.findings.every((item) => item.kept)).toBe(true);
  const one = await host.select(
    TEXT,
    DEFAULT_SETTINGS,
    7,
    rescanned.previewId!,
    "policy",
    [keep[1]],
  );
  const saved = await host.replace(
    TEXT,
    7,
    DEFAULT_SETTINGS,
    one.previewId,
    "policy",
  );
  expect(saved.edits).toHaveLength(1);
  expect(saved.text).toContain(one.findings[0].marker);
});

test("selection rejects stale draft policy tab and malformed occurrences before discarding valid plan", async () => {
  await host.create("correct horse", null, true);
  const first = await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy");
  for (const [text, tab, policy] of [
    [TEXT + "x", 7, "policy"],
    [TEXT, 8, "policy"],
    [TEXT, 7, "new"],
  ] as const)
    await expect(
      host.select(text, DEFAULT_SETTINGS, tab, first.previewId!, policy, []),
    ).rejects.toMatchObject({ code: "preview_expired" });
  await expect(
    host.select(TEXT, DEFAULT_SETTINGS, 7, first.previewId!, "policy", [
      { start: 0, end: 1 },
    ]),
  ).rejects.toMatchObject({ code: "selection_invalid" });
  const selected = await host.select(
    TEXT,
    DEFAULT_SETTINGS,
    7,
    first.previewId!,
    "policy",
    [],
  );
  await host.preview(TEXT, DEFAULT_SETTINGS, 8, 2, "policy");
  await expect(
    host.select(TEXT, DEFAULT_SETTINGS, 7, selected.previewId, "policy", []),
  ).rejects.toMatchObject({ code: "preview_expired" });
});

test("forget retires only the confirmed marker and rejects malformed markers", async () => {
  await host.create("correct horse", null, true);
  const saved = await host.replace(TEXT, 7, DEFAULT_SETTINGS);
  const markers = saved.text.match(/\[\[[A-Z0-9_]+\]\]/g)!;
  await expect(host.forget("prefix" + markers[0])).rejects.toMatchObject({
    code: "invalid_marker",
  });
  await host.forget(markers[0]);
  expect(host.restore(markers[0]).restored).toBe(0);
  expect(host.restore(markers[1]).restored).toBe(1);
});

test("uncertain forget reconciles before access and never reports an unconfirmed retirement", async () => {
  const { routing } = await host.create("correct horse", null, true);
  await host.automaticAccess(routing);
  const saved = await host.replace(TEXT, 7, DEFAULT_SETTINGS);
  const marker = saved.text.match(/\[\[[A-Z0-9_]+\]\]/g)![0];
  owner.failNextSave = Object.assign(new Error(), {
    code: "OutcomeUnknown",
    requestId: new Uint8Array([4]),
  });
  await expect(host.forget(marker)).rejects.toMatchObject({
    code: "OutcomeUnknown",
  });
  expect(host.status(routing).commit).toBe("uncertain");
  await host.automaticAccess(routing);
  expect(vault.reconcileLatest).toHaveBeenCalledWith(new Uint8Array([4]));
  expect(host.restore(marker).restored).toBe(1);
  await host.forget(marker);
  expect(host.restore(marker).restored).toBe(0);
});

test("mixed apply preserves repeated occurrences and UTF16 offsets while storing only Replace", async () => {
  await host.create("correct horse", null, true);
  const text = "🙂 jane@example.com then jane@example.com and al@example.org";
  const initial = await host.preview(text, DEFAULT_SETTINGS, 7, 1, "policy");
  const place = (index: number) => ({
    start: initial.findings[index].start!,
    end: initial.findings[index].end!,
  });
  const selected = await host.select(
    text,
    DEFAULT_SETTINGS,
    7,
    initial.previewId!,
    "policy",
    [place(2)],
    [place(0)],
  );
  expect(selected.findings.map((item) => item.action)).toEqual([
    "redact",
    "replace",
    "keep",
  ]);
  const result = await host.apply(
    text,
    7,
    DEFAULT_SETTINGS,
    selected.previewId,
    "policy",
  );
  expect(result).toMatchObject({
    applied: true,
    saved: true,
    replaced: 1,
    redacted: 1,
  });
  expect(result.text).toBe(
    `🙂 ${selected.findings[0].marker} then ${selected.findings[1].marker} and al@example.org`,
  );
  expect(result.edits.map((edit) => edit.start)).toEqual([3, 25]);
  expect(host.restore(result.text).text).toBe(
    `🙂 ${selected.findings[0].marker} then jane@example.com and al@example.org`,
  );
  expect(host.restore(selected.findings[1].marker).restored).toBe(1);
});

test("all-redact applies authoritative detector labels without a commit", async () => {
  await host.create("correct horse", null, true);
  const initial = await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy");
  const places = initial.findings.map((item) => ({
    start: item.start!,
    end: item.end!,
  }));
  const selected = await host.select(
    TEXT,
    DEFAULT_SETTINGS,
    7,
    initial.previewId!,
    "policy",
    [],
    places,
  );
  const commit = vi.spyOn(owner, "commit");
  const result = await host.apply(
    TEXT,
    7,
    DEFAULT_SETTINGS,
    selected.previewId,
    "policy",
  );
  expect(result).toMatchObject({
    applied: true,
    saved: false,
    replaced: 0,
    redacted: 2,
  });
  expect(result.text).not.toContain("@");
  expect(commit).not.toHaveBeenCalled();
  await expect(
    host.apply(TEXT, 7, DEFAULT_SETTINGS, selected.previewId, "policy"),
  ).rejects.toMatchObject({ code: "preview_expired" });
});

test("mixed selection rejects overlapping modes, duplicate and malformed ranges without consuming the plan", async () => {
  await host.create("correct horse", null, true);
  const initial = await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy");
  const place = {
    start: initial.findings[0].start!,
    end: initial.findings[0].end!,
  };
  for (const [keep, redact] of [
    [[place], [place]],
    [[], [place, place]],
    [[], [{ start: place.start + 1, end: place.end }]],
  ]) {
    await expect(
      host.select(
        TEXT,
        DEFAULT_SETTINGS,
        7,
        initial.previewId!,
        "policy",
        keep,
        redact,
      ),
    ).rejects.toMatchObject({ code: "selection_invalid" });
  }
  const selected = await host.select(
    TEXT,
    DEFAULT_SETTINGS,
    7,
    initial.previewId!,
    "policy",
    [],
    [place],
  );
  for (const [text, tab, policy] of [
    [TEXT + " edit", 7, "policy"],
    [TEXT, 8, "policy"],
    [TEXT, 7, "changed"],
  ] as const) {
    await expect(
      host.apply(text, tab, DEFAULT_SETTINGS, selected.previewId, policy),
    ).rejects.toMatchObject({ code: "preview_expired" });
  }
  const result = await host.apply(
    TEXT,
    7,
    DEFAULT_SETTINGS,
    selected.previewId,
    "policy",
  );
  expect(result.replaced).toBe(1);
});

test("a mixed save failure returns no editor patch and commits no originals", async () => {
  await host.create("correct horse", null, true);
  const initial = await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy");
  const selected = await host.select(
    TEXT,
    DEFAULT_SETTINGS,
    7,
    initial.previewId!,
    "policy",
    [],
    [{ start: initial.findings[0].start!, end: initial.findings[0].end! }],
  );
  owner.failNextSave = new Error("write failed");
  await expect(
    host.apply(TEXT, 7, DEFAULT_SETTINGS, selected.previewId, "policy"),
  ).rejects.toThrow();
  expect(workspace.counts().transformedSpans).toBe(0);
});

test("mixed selection supplies Core only the Replace findings and refuses stale cross-tab apply", async () => {
  await host.create("correct horse", null, true);
  const initial = await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy");
  const prepare = vi.spyOn(owner, "prepare");
  const selected = await host.select(
    TEXT,
    DEFAULT_SETTINGS,
    7,
    initial.previewId!,
    "policy",
    [],
    [{ start: initial.findings[0].start!, end: initial.findings[0].end! }],
  );
  expect(prepare).toHaveBeenLastCalledWith(
    TEXT,
    [expect.objectContaining({ matchedText: "al@example.org" })],
    expect.any(Uint8Array),
  );
  expect(prepare.mock.calls.at(-1)![1]).toHaveLength(1);
  await host.preview(TEXT, DEFAULT_SETTINGS, 8, 1, "policy");
  await expect(
    host.apply(TEXT, 7, DEFAULT_SETTINGS, selected.previewId, "policy"),
  ).rejects.toMatchObject({ code: "preview_expired" });
  expect(workspace.counts().transformedSpans).toBe(0);
});

test("Redact can label a trusted recalled original without a fresh detector match", async () => {
  await host.create("correct horse", null, true);
  const initial = await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy");
  await host.replace(TEXT, 7, DEFAULT_SETTINGS, initial.previewId, "policy");
  const noDetectors = { ...DEFAULT_SETTINGS, entities: [] };
  const recalled = await host.preview(TEXT, noDetectors, 7, 2, "policy-next");
  expect(recalled.findings).toHaveLength(2);
  const selected = await host.select(
    TEXT,
    noDetectors,
    7,
    recalled.previewId!,
    "policy-next",
    [],
    recalled.findings.map((item) => ({ start: item.start!, end: item.end! })),
  );
  const commit = vi.spyOn(owner, "commit");
  const result = await host.apply(
    TEXT,
    7,
    noDetectors,
    selected.previewId,
    "policy-next",
  );
  expect(result.text).toBe("Ask [EMAIL] or [EMAIL] today");
  expect(commit).not.toHaveBeenCalled();
});

test("PDF read-only review preserves an interactive paste reservation", async () => {
  await host.create("correct horse", null, true);
  const paste = await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy");
  const pdf = await host.pdfReview("🙂 zoe@example.org", DEFAULT_SETTINGS);
  expect(pdf).toMatchObject([
    { start: 3, end: 18, original: "zoe@example.org", action: "replace" },
  ]);
  const saved = await host.replace(
    TEXT,
    7,
    DEFAULT_SETTINGS,
    paste.previewId,
    "policy",
  );
  expect(host.restore(saved.text).text).toBe(TEXT);
});

test("PDF review includes remembered originals when fresh detection is disabled", async () => {
  await host.create("correct horse", null, true);
  const first = await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy");
  await host.replace(TEXT, 7, DEFAULT_SETTINGS, first.previewId, "policy");
  const review = await host.pdfReview(TEXT, {
    ...DEFAULT_SETTINGS,
    entities: [],
  });
  expect(review).toHaveLength(2);
  expect(review.map((item) => item.original)).toEqual(
    first.findings.map((item) => item.original),
  );
});

const PDF_DRAFT = {
  tabId: 7,
  url: "https://chatgpt.com/c/test",
  text: "Existing draft",
  revision: 1,
  documentId: "document",
};
async function pdfChunksForTest() {
  const texts = [
    "Email jane@example.com and redact al@example.org.",
    "Keep zoe@example.org and repeat jane@example.com.",
  ];
  return Promise.all(
    texts.map(async (text, index) => ({
      id: String(index),
      text,
      policyVersion: "policy",
      findings: (await host.pdfReview(text, DEFAULT_SETTINGS)).map((item) => ({
        ...item,
        action:
          item.original === "al@example.org"
            ? ("redact" as const)
            : item.original === "zoe@example.org"
              ? ("keep" as const)
              : ("replace" as const),
      })),
    })),
  );
}

test("PDF batch preview uses exact tokens without saving and commits the displayed mixed actions once", async () => {
  await host.create("correct horse", null, true);
  const commit = vi.spyOn(owner, "commit");
  const preview = await host.pdfPreview(
    await pdfChunksForTest(),
    PDF_DRAFT,
    DEFAULT_SETTINGS,
    "policy",
  );
  expect(commit).not.toHaveBeenCalled();
  expect(preview.chunks[0].text).toMatch(
    /^Email \[\[EMAIL_[A-Z0-9]+\]\] and redact \[EMAIL\]\.$/,
  );
  expect(preview.chunks[1].text).toContain("Keep zoe@example.org");
  const token = preview.chunks[0].edits[0].replacement;
  expect(preview.chunks[1].text).toContain(token);
  expect(host.restore(token).text).toBe(token);
  const applied = await host.pdfApply(
    preview.previewId,
    PDF_DRAFT,
    DEFAULT_SETTINGS,
    "policy",
  );
  expect(applied.chunks).toEqual(preview.chunks);
  expect(applied.saved).toBe(true);
  expect(commit).toHaveBeenCalledOnce();
  expect(host.restore(token).text).toBe("jane@example.com");
  expect(host.restore("[EMAIL]").text).toBe("[EMAIL]");
  await expect(
    host.pdfApply(preview.previewId, PDF_DRAFT, DEFAULT_SETTINGS, "policy"),
  ).rejects.toMatchObject({ code: "pdf_review_expired" });
});

test("PDF exact preview expires after a competing paste and cannot be cancelled by an old id", async () => {
  await host.create("correct horse", null, true);
  const preview = await host.pdfPreview(
    await pdfChunksForTest(),
    PDF_DRAFT,
    DEFAULT_SETTINGS,
    "policy",
  );
  host.pdfCancel("stale-id");
  await host.preview(TEXT, DEFAULT_SETTINGS, 7, 1, "policy");
  await expect(
    host.pdfApply(preview.previewId, PDF_DRAFT, DEFAULT_SETTINGS, "policy"),
  ).rejects.toMatchObject({ code: "pdf_review_expired" });
});

test("PDF preview rejects changed draft or policy and returns no output after a failed commit", async () => {
  await host.create("correct horse", null, true);
  const preview = await host.pdfPreview(
    await pdfChunksForTest(),
    PDF_DRAFT,
    DEFAULT_SETTINGS,
    "policy",
  );
  await expect(
    host.pdfApply(
      preview.previewId,
      { ...PDF_DRAFT, revision: 2 },
      DEFAULT_SETTINGS,
      "policy",
    ),
  ).rejects.toMatchObject({ code: "pdf_review_expired" });
  await expect(
    host.pdfApply(preview.previewId, PDF_DRAFT, DEFAULT_SETTINGS, "new-policy"),
  ).rejects.toMatchObject({ code: "pdf_review_expired" });
  owner.failNextSave = { code: "vault_write_failed" };
  await expect(
    host.pdfApply(preview.previewId, PDF_DRAFT, DEFAULT_SETTINGS, "policy"),
  ).rejects.toMatchObject({ code: "vault_write_failed" });
});

test("PDF all-Keep and Redact-only previews allocate no durable mappings", async () => {
  await host.create("correct horse", null, true);
  const chunks = await pdfChunksForTest();
  for (const chunk of chunks)
    for (const item of chunk.findings) item.action = "keep";
  const commit = vi.spyOn(owner, "commit");
  const preview = await host.pdfPreview(
    chunks,
    PDF_DRAFT,
    DEFAULT_SETTINGS,
    "policy",
  );
  const kept = await host.pdfApply(
    preview.previewId,
    PDF_DRAFT,
    DEFAULT_SETTINGS,
    "policy",
  );
  expect(kept.chunks.map((chunk) => chunk.text)).toEqual(
    chunks.map((chunk) => chunk.text),
  );
  expect(kept.saved).toBe(false);
  for (const chunk of chunks)
    for (const item of chunk.findings) item.action = "redact";
  const redacted = await host.pdfPreview(
    chunks,
    PDF_DRAFT,
    DEFAULT_SETTINGS,
    "policy",
  );
  expect(redacted.chunks[0].text).toBe("Email [EMAIL] and redact [EMAIL].");
  await host.pdfApply(
    redacted.previewId,
    PDF_DRAFT,
    DEFAULT_SETTINGS,
    "policy",
  );
  expect(commit).not.toHaveBeenCalled();
});

test("PDF preview rejects omitted or duplicated findings", async () => {
  await host.create("correct horse", null, true);
  const chunks = await pdfChunksForTest();
  chunks[0].findings.pop();
  await expect(
    host.pdfPreview(chunks, PDF_DRAFT, DEFAULT_SETTINGS, "policy"),
  ).rejects.toMatchObject({ code: "pdf_review_expired" });
});
