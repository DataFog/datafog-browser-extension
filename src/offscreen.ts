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
import { blockingSends } from "./settings";
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
async function handle({
  request,
  settings,
  routing = null,
}: OffscreenRequest): Promise<unknown> {
  await engine;
  await loaded;
  // Using the vault, or opening the panel, unlocks it with a remembered device
  if (
    request.type === "pseudonymize" ||
    request.type === "restore" ||
    (request.type === "vault-status" && request.autoUnlock === true)
  )
    await host.unlockWithDevice(routing);
  switch (request.type) {
    case "scan":
      return {
        seq: request.seq,
        enabled: settings.enabled,
        counts: settings.enabled
          ? await countFindings(request.text, settings, scanner)
          : {},
        blockSends: blockingSends(settings),
      };
    case "redact":
      return redact(request.text, settings, scanner);
    case "vault-status":
      return host.status(routing);
    case "vault-create":
      return host.create(request.password, routing, request.remember);
    case "vault-unlock":
      return host.unlock(request.password, routing, request.remember);
    case "vault-lock":
      return host.lock(routing, true);
    case "device-forget":
      return host.forgetDevice(routing);
    case "vault-delete":
      return host.deleteVault(routing);
    case "pseudonymize":
      await host.pseudonymize(request.text, request.tabId, settings);
      return host.status(routing);
    case "restore":
      return host.restore(request.text);
    case "review-source":
      return { source: host.source() };
    case "review-approve":
      return host.approve(settings);
    case "review-mark-sensitive":
      return host.markSensitive(request.index, settings);
    case "review-cancel":
      host.cancel();
      return host.status(routing);
    case "review-not-sensitive":
      await host.markNotSensitive(request.index);
      return host.status(routing);
    case "choice-clear":
      await host.clearChoice({
        entityType: request.entityType,
        value: request.value,
      });
      return host.status(routing);
    default:
      return { error: "unknown_request" };
  }
}

// Content script messages reach every extension page; answer forwarded ones only
chrome.runtime.onMessage.addListener(
  (message: OffscreenRequest | Request | PanelNotice, _sender, respond) => {
    if (!("target" in message) || message.target !== "offscreen") return false;
    handle(message).then(respond, (error) => {
      const response = toError(error);
      // The code only: an error's message can quote prompt text
      console.warn(`DataFog ${message.request.type} failed: ${response.error}`);
      respond(response);
    });
    return true;
  },
);
