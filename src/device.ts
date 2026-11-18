/**
 * Non-exportable profile-local WebCrypto keys, compatible with FogVault device
 * identities. Automatic keys have no expiry. Legacy keys are retained and
 * promoted only after a verified unwrap. Settings and marker indexes share
 * this key in authenticated ciphertext, committed before policy activation.
 */

import type { KeyProvider, ProviderIdentity } from "@datafog/fogvault-browser";

/** How long a remembered device unlocks the vault, as the ADR sets. */
export const REMEMBER_MS = 30 * 24 * 60 * 60_000;

/** Identifies DataFog's WebCrypto provider to FogVault. */
const PROVIDER_ID = new TextEncoder().encode("datafog-webcrypt");

const DATABASE = "datafog-device";
const STORE = "devices";
const SETTINGS = "settings";

/** One device key, or what's left of it once forgotten. */
export interface DeviceRecord {
  /** The key's FogVault identity, base64. */
  keyId: string;
  /** Null once forgotten. */
  key: CryptoKey | null;
  /** When it was remembered, in epoch milliseconds. */
  rememberedAt: number;
  /** Automatic access has no expiry. Legacy keys are promoted after verification. */
  automatic?: boolean;
}

/** What the host needs from remembered devices. */
export interface Devices {
  /** Load the records; call before anything else. */
  load(): Promise<void>;
  /** Every identity FogVault must know, including forgotten ones. */
  providers(): KeyProvider[];
  /** The key that may unlock the vault now, if any. */
  active(now: number): DeviceRecord | null;
  /** When the remembered key expires, paused or not, or null if none. */
  rememberedUntil(now: number): number | null;
  /** Delete keys past 30 days. */
  prune(now: number): Promise<void>;
  /** Make a new key, kept until it's enrolled or forgotten. */
  create(now: number): Promise<ProviderIdentity>;
  /** Delete every key, keeping the identities. */
  forget(): Promise<void>;
  /** Whether a manual lock has paused device unlock until a password unlock. */
  paused(): boolean;
  setPaused(paused: boolean): Promise<void>;
  /** Delete everything, for a deleted vault. */
  clear(): Promise<void>;
  promote?(): Promise<void>;
  existing?(): DeviceRecord | null;
}

/**
 * Encode bytes as base64.
 *
 * @param bytes The bytes.
 * @returns Their base64 text.
 */
function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Decode base64 text.
 *
 * @param text The base64 text.
 * @returns Its bytes.
 */
export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/**
 * A device key's FogVault identity.
 *
 * @param keyId The key's identity, base64.
 * @returns The identity.
 */
export function identityOf(keyId: string): ProviderIdentity {
  return {
    providerId: PROVIDER_ID.slice(),
    keyId: fromBase64(keyId),
    deviceBound: true,
    nonexportable: true,
  };
}

/**
 * An error carrying only a code.
 *
 * @param code The code.
 * @returns The error.
 */
function failure(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/**
 * The FogVault provider for one device key: AES-GCM, bound to FogVault's
 * authenticated context. A forgotten key can't unwrap.
 *
 * @param record The device's record.
 * @returns The provider.
 */
function providerFor(record: DeviceRecord): KeyProvider {
  return {
    identity: identityOf(record.keyId),
    capability: "NonExportableOperation",
    async wrapSeed(context, seed) {
      if (!record.key) throw failure("device_forgotten");
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plain = new Uint8Array(seed);
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv,
            additionalData: new Uint8Array(context.authenticatedBytes),
          },
          record.key,
          plain,
        ),
      );
      plain.fill(0);
      const wrapped = new Uint8Array(iv.length + sealed.length);
      wrapped.set(iv);
      wrapped.set(sealed, iv.length);
      return wrapped;
    },
    async unwrapSeed(context, wrapped) {
      if (!record.key) throw failure("device_forgotten");
      return new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: new Uint8Array(wrapped.slice(0, 12)),
            additionalData: new Uint8Array(context.authenticatedBytes),
          },
          record.key,
          new Uint8Array(wrapped.slice(12)),
        ),
      );
    },
  };
}

/**
 * Wait for an IndexedDB request.
 *
 * @param request The request.
 * @returns Its result.
 */
function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(failure("device_storage")));
  });
}

/** Device keys in this extension's IndexedDB. */
export class DeviceKeys implements Devices {
  private records: DeviceRecord[] = [];
  private pausedNow = false;

  /**
   * Open the database, creating its stores the first time.
   *
   * @returns The database.
   */
  private async open(): Promise<IDBDatabase> {
    const request = indexedDB.open(DATABASE, 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(STORE, { keyPath: "keyId" });
      request.result.createObjectStore(SETTINGS);
    });
    return settle(request);
  }

  /**
   * Run one transaction, then close the database.
   *
   * @param work What to do in it.
   * @returns Its result.
   */
  private async run<T>(
    work: (stores: {
      devices: IDBObjectStore;
      settings: IDBObjectStore;
    }) => Promise<T>,
  ): Promise<T> {
    const database = await this.open();
    try {
      const transaction = database.transaction([STORE, SETTINGS], "readwrite");
      // Listen before working, so a quick commit isn't missed
      const done = new Promise((resolve, reject) => {
        transaction.addEventListener("complete", resolve);
        transaction.addEventListener("error", () =>
          reject(failure("device_storage")),
        );
        transaction.addEventListener("abort", () =>
          reject(failure("device_storage")),
        );
      });
      const result = await work({
        devices: transaction.objectStore(STORE),
        settings: transaction.objectStore(SETTINGS),
      });
      await done;
      return result;
    } finally {
      database.close();
    }
  }

  async load(): Promise<void> {
    await this.run(async ({ devices, settings }) => {
      this.records = await settle<DeviceRecord[]>(devices.getAll());
      this.pausedNow = (await settle(settings.get("paused"))) === true;
    });
  }

  existing(): DeviceRecord | null {
    return this.records.find((record) => record.key) ?? null;
  }

  async readRouting(): Promise<import("./messages").VaultRouting | null> {
    return (
      (await this.run(async ({ settings }) =>
        settle(settings.get("routing")),
      )) ?? null
    );
  }

  async writeRouting(
    routing: import("./messages").VaultRouting,
  ): Promise<void> {
    await this.run(async ({ settings }) =>
      settle(settings.put(routing, "routing")),
    );
  }

  providers(): KeyProvider[] {
    return this.records.map(providerFor);
  }

  active(now: number): DeviceRecord | null {
    return this.pausedNow ? null : this.current(now);
  }

  rememberedUntil(now: number): number | null {
    const record = this.current(now);
    return record
      ? record.automatic
        ? Number.MAX_SAFE_INTEGER
        : record.rememberedAt + REMEMBER_MS
      : null;
  }

  async prune(now: number): Promise<void> {
    if (this.records.some((record) => record.key) && this.current(now) === null)
      await this.forget();
  }

  /**
   * The key within its 30 days, if any.
   *
   * @param now The time now.
   * @returns Its record.
   */
  private current(now: number): DeviceRecord | null {
    return (
      this.records.find(
        (record) =>
          record.key &&
          (record.automatic || now - record.rememberedAt < REMEMBER_MS),
      ) ?? null
    );
  }

  async create(now: number): Promise<ProviderIdentity> {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const record: DeviceRecord = {
      keyId: toBase64(crypto.getRandomValues(new Uint8Array(16))),
      key,
      rememberedAt: now,
      automatic: true,
    };
    await this.run(async ({ devices }) => settle(devices.put(record)));
    this.records.push(record);
    return identityOf(record.keyId);
  }

  /** Promote an existing, successfully verified local key without replacing it. */
  async promote(): Promise<void> {
    const records = this.records.map((record) => ({
      ...record,
      automatic: !!record.key,
    }));
    await this.run(async ({ devices, settings }) => {
      for (const record of records) await settle(devices.put(record));
      await settle(settings.put(false, "paused"));
    });
    this.records = records;
    this.pausedNow = false;
  }

  /** Read authenticated ciphertext using the same non-exportable local key. */
  async readPreferences(): Promise<unknown> {
    const envelope = await this.run(async ({ settings }) =>
      settle<
        { keyId: string; iv: Uint8Array; ciphertext: ArrayBuffer } | undefined
      >(settings.get("preferences")),
    );
    if (!envelope) return null;
    const key = this.records.find(
      (record) => record.keyId === envelope.keyId,
    )?.key;
    if (!key) throw failure("preferences_key_missing");
    try {
      const bytes = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(envelope.iv),
          additionalData: new TextEncoder().encode("datafog/preferences/v1"),
        },
        key,
        envelope.ciphertext,
      );
      const plain = new Uint8Array(bytes);
      try {
        return JSON.parse(new TextDecoder().decode(plain));
      } finally {
        plain.fill(0);
      }
    } catch {
      throw failure("preferences_unavailable");
    }
  }

  /** A committed and verified envelope precedes every effective policy change. */
  async writePreferences(value: unknown): Promise<void> {
    const record = this.records.find((item) => item.key);
    if (!record?.key) throw failure("preferences_key_missing");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(value));
    let ciphertext: ArrayBuffer;
    try {
      ciphertext = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode("datafog/preferences/v1"),
        },
        record.key,
        plain,
      );
    } finally {
      plain.fill(0);
    }
    await this.run(async ({ settings }) =>
      settle(
        settings.put({ keyId: record.keyId, iv, ciphertext }, "preferences"),
      ),
    );
    if (JSON.stringify(await this.readPreferences()) !== JSON.stringify(value))
      throw failure("preferences_verification_failed");
  }

  async forget(): Promise<void> {
    const forgotten = this.records.map((record) => ({ ...record, key: null }));
    await this.run(async ({ devices }) => {
      for (const record of forgotten) await settle(devices.put(record));
    });
    this.records = forgotten;
  }

  paused(): boolean {
    return this.pausedNow;
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.run(async ({ settings }) =>
      settle(settings.put(paused, "paused")),
    );
    this.pausedNow = paused;
  }

  async clear(): Promise<void> {
    await this.run(async ({ devices, settings }) => {
      await settle(devices.clear());
      await settle(settings.clear());
    });
    this.records = [];
    this.pausedNow = false;
  }
}
