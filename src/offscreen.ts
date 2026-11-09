/**
 * Offscreen document: runs DataFog Core and the vault, so they stay loaded
 * while the side panel is closed and the service worker is stopped.
 */

import { FogVaultWorkspace } from "@datafog/core-fogvault-browser";
import { FogVault, randomId } from "@datafog/fogvault-browser";
import { Workspace } from "@datafog/wasm";

import { countFindings, ready, redact, workspaceFindings } from "./detect";
import {
  toError,
  type OffscreenRequest,
  type PanelNotice,
  type Request,
} from "./messages";
import { blockingSends } from "./settings";
import { VaultHost } from "./vault";

// Start loading Core right away; requests wait on it
const engine = ready();

const host = new VaultHost({
  newVault: () =>
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
  findings: workspaceFindings,
  randomId,
  notify: () => {
    const notice: PanelNotice = { target: "panel", type: "vault-changed" };
    // No panel open means no one to tell
    chrome.runtime.sendMessage(notice).catch(() => {});
  },
});

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
  switch (request.type) {
    case "scan":
      return {
        seq: request.seq,
        enabled: settings.enabled,
        counts: settings.enabled ? countFindings(request.text, settings) : {},
        blockSends: blockingSends(settings),
      };
    case "redact":
      return redact(request.text, settings);
    case "vault-status":
      return host.status(routing);
    case "vault-create":
      return host.create(request.password, routing);
    case "vault-unlock":
      return host.unlock(request.password, routing);
    case "vault-lock":
      return host.lock(routing);
    case "pseudonymize":
      await host.pseudonymize(request.text, request.tabId, settings);
      return host.status(routing);
    case "review-source":
      return { source: host.source() };
    case "review-approve":
      return host.approve();
    case "review-cancel":
      host.cancel();
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
