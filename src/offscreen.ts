/**
 * Offscreen document: runs DataFog Core and the vault, so they stay loaded
 * while the side panel is closed and the service worker is stopped.
 */

import { FogVaultWorkspace } from "@datafog/core-fogvault-browser";
import { FogVault, randomId } from "@datafog/fogvault-browser";
import { Workspace } from "@datafog/wasm";
import { CnnSession } from "@datafog/wasm/cnn";

import {
  countFindings,
  ready,
  redact,
  skipChoices,
  workspaceFindings,
} from "./detect";
import { DeviceKeys } from "./device";
import {
  toError,
  type OffscreenRequest,
  type PanelNotice,
  type Request,
} from "./messages";
import { ModelScanner } from "./model";
import {
  blockingSends,
  forSite,
  normalizeSettings,
  type Settings,
} from "./settings";
import type { VaultRouting, ReviewItem } from "./messages";
import { VaultHost } from "./vault";

// Start loading Core right away; requests wait on it
const engine = ready();

// The model loads on the first scan that needs it
const model = new ModelScanner(() =>
  CnnSession.open({
    // Its Worker loads from Core's own unbundled files
    workerUrl: chrome.runtime.getURL("datafog/wasm/cnn/worker.js"),
  }),
);

const devices = new DeviceKeys();
// Device keys load once; requests wait on them, as on Core
const loaded = devices.load();

const host = new VaultHost({
  devices,
  now: Date.now,
  newVault: (providers) =>
    new FogVault({
      // Room for one workspace; FogVault rejects anything larger
      limits: {
        payload: 16 * 1024 * 1024,
        metadata: 88,
        records: 64,
        staging: 32 * 1024 * 1024,
      },
      kdfProfiles: [{ memory_kib: 65_536, passes: 3 }],
      storageProfile: "arraybuffer",
      // Password, or a remembered device; room for a device key a month
      access: {
        profiles: ["password", "password-or-device"],
        maxDescriptorBytes: 4096,
        maxDeviceSlots: 16,
        maxProviderBlobBytes: 256,
      },
      providers,
      // The Worker loads from its own unbundled files
      workerUrl: chrome.runtime.getURL("fogvault/worker.mjs"),
    }),
  createOwner: (vault, route) =>
    FogVaultWorkspace.create({
      Workspace,
      vault,
      ...route,
    }),
  openOwner: (vault, { recordId, namespace }) =>
    FogVaultWorkspace.open({
      Workspace,
      vault,
      recordId,
      expectedNamespace: namespace,
    }),
  findings: (text, settings) => workspaceFindings(text, settings, model.scan),
  randomId,
  deleteStore: (name) =>
    new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.addEventListener("success", () => resolve());
      request.addEventListener("blocked", () =>
        reject(Object.assign(new Error(), { code: "delete_blocked" })),
      );
      request.addEventListener("error", () =>
        reject(Object.assign(new Error(), { code: "delete_failed" })),
      );
    }),
  notify: () => {
    const notice: PanelNotice = { target: "panel", type: "vault-changed" };
    // No panel open means no one to tell
    chrome.runtime.sendMessage(notice).catch(() => {});
  },
});

// The badge and Redact skip values remembered as not sensitive, while unlocked
const scanner = skipChoices(model.scan, () => host.notSensitive());

/**
 * Answer one request forwarded by the service worker.
 *
 * @param message The forwarded request, the settings and the vault's routing.
 * @returns The response to send back.
 */
interface Preferences {
  version: 1;
  policyVersion: string;
  settings: Settings;
  markers: string[];
}
type PolicyState =
  | { phase: "unloaded" | "reading" }
  | { phase: "ready"; value: Preferences }
  | { phase: "saving"; operationId: string }
  | { phase: "uncertain"; operationId: string; error: string }
  | { phase: "unavailable"; error: string };
let policyState: PolicyState = { phase: "unloaded" };

/** The cache is revoked before a write, including an ambiguous readback failure. */
async function commitPreferences(next: Preferences): Promise<void> {
  const operationId = crypto.randomUUID();
  policyState = { phase: "saving", operationId };
  try {
    await devices.writePreferences(next);
    policyState = { phase: "ready", value: next };
  } catch (error) {
    policyState = {
      phase: "uncertain",
      operationId,
      error: toError(error).error,
    };
    throw error;
  }
}
type AccessState =
  | { phase: "unloaded" | "initializing" }
  | { phase: "ready"; routing: VaultRouting }
  | { phase: "unavailable"; error: string };
let accessState: AccessState = { phase: "unloaded" };

async function access(routing: VaultRouting | null): Promise<VaultRouting> {
  accessState = { phase: "initializing" };
  try {
    const backup = await devices.readRouting();
    if (
      routing &&
      backup &&
      (routing.recordId !== backup.recordId ||
        routing.namespace !== backup.namespace)
    )
      throw Object.assign(new Error(), { code: "vault_routing_conflict" });
    let currentRouting =
      routing && backup
        ? {
            ...backup,
            ...routing,
            automatic: routing.automatic || backup.automatic,
            preferences: routing.preferences ?? backup.preferences,
          }
        : (routing ?? backup);
    if (!currentRouting) {
      // Existing data without its routing is an access failure, never a new store.
      const databases = await indexedDB.databases();
      if (
        databases.some(({ name }) => name === "datafog") ||
        devices.existing()
      )
        throw Object.assign(new Error(), {
          code: "vault_bootstrap_incomplete",
        });
      const password = crypto.getRandomValues(new Uint8Array(32));
      try {
        const created = await host.create(
          Array.from(password, (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
          null,
          true,
        );
        currentRouting = { ...created.routing, automatic: true };
        await devices.writeRouting(currentRouting);
      } finally {
        password.fill(0);
      }
    }
    await host.automaticAccess(currentRouting);
    accessState = { phase: "ready", routing: currentRouting };
    return currentRouting;
  } catch (error) {
    const code = toError(error).error;
    accessState = {
      phase: "unavailable",
      error: code,
    };
    throw error;
  }
}

function isPreferences(value: unknown): value is Preferences {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("policyVersion" in value) ||
    typeof value.policyVersion !== "string" ||
    !("markers" in value) ||
    !Array.isArray(value.markers) ||
    !value.markers.every((item) => typeof item === "string") ||
    !("settings" in value) ||
    typeof value.settings !== "object" ||
    value.settings === null
  )
    return false;
  const settings = value.settings;
  return (
    "off" in settings &&
    Array.isArray(settings.off) &&
    settings.off.every((item) => typeof item === "string") &&
    "entities" in settings &&
    Array.isArray(settings.entities) &&
    settings.entities.every((item) => typeof item === "string") &&
    "allowlist" in settings &&
    Array.isArray(settings.allowlist) &&
    settings.allowlist.every((item) => typeof item === "string") &&
    "denylist" in settings &&
    Array.isArray(settings.denylist) &&
    settings.denylist.every((item) => typeof item === "string") &&
    "blockSends" in settings &&
    typeof settings.blockSends === "boolean"
  );
}

/** The token describes only committed policy, including legacy typed choices. */
async function policyVersion(stored: Preferences): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify([stored.policyVersion, host.notSensitive()]),
  );
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  bytes.fill(0);
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function policy(
  legacy?: Partial<Settings>,
  required = false,
): Promise<Preferences> {
  if (policyState.phase === "ready") return policyState.value;
  // Every retry after an uncertain write decrypts durable state before any scan.
  policyState = { phase: "reading" };
  try {
    const saved = await devices.readPreferences();
    if (saved) {
      if (!isPreferences(saved))
        throw Object.assign(new Error(), { code: "preferences_invalid" });
      policyState = { phase: "ready", value: saved };
      return saved;
    }
    if (required)
      throw Object.assign(new Error(), { code: "preferences_missing" });
    const migrated: Preferences = {
      version: 1,
      policyVersion: crypto.randomUUID(),
      settings: normalizeSettings(legacy ?? {}),
      markers: [],
    };
    if (!isPreferences(migrated))
      throw Object.assign(new Error(), { code: "preferences_invalid" });
    await commitPreferences(migrated);
    return migrated;
  } catch (error) {
    // commitPreferences owns an uncertain write; reads own unavailable state.
    if (policyState.phase === "reading")
      policyState = { phase: "unavailable", error: toError(error).error };
    throw error;
  }
}

function originals(stored: Preferences): ReviewItem[] {
  return stored.markers.flatMap((marker) => {
    const value = host.restore(marker).values[0];
    return value
      ? [
          {
            entityType: /^\[\[(.+)_[A-Z0-9]+\]\]$/.exec(marker)?.[1] ?? "Value",
            original: value.original,
            marker,
          },
        ]
      : [];
  });
}

async function handle(message: OffscreenRequest): Promise<unknown> {
  await engine;
  await loaded;
  const { request } = message;
  let routing = message.routing ?? (await devices.readRouting());
  if (request.type === "vault-delete") {
    const result = await host.deleteVault(routing);
    policyState = { phase: "unloaded" };
    accessState = { phase: "unloaded" };
    return { result, storage: { deleted: true } };
  }
  try {
    routing = await access(routing);
  } catch (error) {
    if (request.type === "vault-status")
      return {
        result: {
          ...host.status(routing),
          access: "unavailable",
          reviewError: toError(error).error,
        },
      };
    throw error;
  }
  const stored = await policy(
    message.legacySettings,
    routing.preferences === 1,
  );
  if (routing.preferences !== 1) {
    routing = { ...routing, preferences: 1 };
    await devices.writeRouting(routing);
    accessState = { phase: "ready", routing };
  }
  const settings = forSite(stored.settings, message.host);
  let result: unknown;
  switch (request.type) {
    case "scan": {
      const version = await policyVersion(stored);
      const preview = settings.enabled
        ? await host.preview(
            request.text,
            settings,
            request.tabId ?? -1,
            request.seq,
            version,
          )
        : { findings: [] };
      result = {
        seq: request.seq,
        enabled: settings.enabled,
        counts: settings.enabled
          ? await countFindings(request.text, settings, scanner)
          : {},
        ...preview,
        policyVersion: version,
        blockSends: blockingSends(settings),
      };
      break;
    }
    case "redact":
      result = await redact(request.text, settings, scanner);
      break;
    case "settings-get":
      result = { ...settings, policyVersion: await policyVersion(stored) };
      break;
    case "settings-save": {
      const next = {
        ...stored,
        settings: normalizeSettings({
          ...request.settings,
          policyVersion: undefined,
        }),
        policyVersion: crypto.randomUUID(),
      };
      if (!isPreferences(next))
        throw Object.assign(new Error(), { code: "preferences_invalid" });
      await commitPreferences(next);
      result = { saved: true, policyVersion: await policyVersion(next) };
      break;
    }
    case "always-allow":
      await host.allowValue(request.entityType, request.value);
      result = { saved: true, policyVersion: await policyVersion(stored) };
      break;
    case "vault-status":
      result = {
        ...host.status(routing),
        access: accessState.phase === "ready" ? "ready" : "unavailable",
        originals: originals(stored),
      };
      break;
    case "pseudonymize": {
      const response = await host.replace(
        request.text,
        request.tabId,
        settings,
        request.previewId,
        await policyVersion(stored),
      );
      result = response;
      const markers = [
        ...new Set([
          ...stored.markers,
          ...(response.text.match(/\[\[[A-Z0-9_]+\]\]/g) ?? []),
        ]),
      ];
      const next = { ...stored, markers };
      try {
        await commitPreferences(next);
      } catch {
        // The mapping commit already succeeded. An auxiliary index failure
        // must never be mislabeled as a failed save of originals.
        result = { ...response, warning: "originals_index_unavailable" };
      }
      break;
    }
    case "restore":
      result = host.restore(request.text);
      break;
    case "choice-clear":
      await host.clearChoice({
        entityType: request.entityType,
        value: request.value,
      });
      result = {
        ...host.status(routing),
        policyVersion: await policyVersion(stored),
      };
      break;
    case "review-source":
      result = { source: host.source() };
      break;
    case "review-approve":
      result = await host.approve(settings);
      break;
    case "review-mark-sensitive":
      result = await host.markSensitive(request.index, settings);
      break;
    case "review-cancel":
      host.cancel();
      result = host.status(routing);
      break;
    case "review-not-sensitive":
      await host.markNotSensitive(request.index);
      result = host.status(routing);
      break;
    default:
      throw Object.assign(new Error(), { code: "obsolete_request" });
  }
  return { result, storage: { routing, migrated: true } };
}

// Serialize ownership of Core's single prepared-change slot and policy commits.
let queue: Promise<unknown> = Promise.resolve();

// Content script messages reach every extension page; answer forwarded ones only
chrome.runtime.onMessage.addListener(
  (message: OffscreenRequest | Request | PanelNotice, _sender, respond) => {
    if (!("target" in message) || message.target !== "offscreen") return false;
    const pending = queue.then(() => handle(message));
    queue = pending.catch(() => {});
    pending.then(respond, (error) => {
      const response = toError(error);
      // The code only: an error's message can quote prompt text
      console.warn(`datafog ${message.request.type} failed: ${response.error}`);
      respond(response);
    });
    return true;
  },
);
