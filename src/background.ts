/**
 * Service worker: keeps the offscreen document open and passes the content
 * script's requests to it. Core runs there, since Chrome stops this worker
 * when idle.
 */

import {
  NO_CHAT_BOX,
  NO_CHAT_BOX_UPDATE,
  toError,
  type CreatedVault,
  type ErrorResponse,
  type OffscreenRequest,
  type PanelNotice,
  type PanelRequest,
  type MarkedSensitive,
  type Pseudonymized,
  type Request,
  type RestoredInPage,
  type RestoredWithValues,
  type ReviewSource,
  type TabRequest,
  type VaultRequest,
  type VaultRouting,
  type VaultStatus,
} from "./messages";
import { blockingSends, DEFAULT_SETTINGS, type Settings } from "./settings";
import { PENDING_UPDATE, updateWaiting } from "./update";
import { UNREACHED_TABS } from "./welcome-state";

let opening: Promise<void> | undefined;

/** Each open side panel's connection, by window. */
const panels = new Map<number, chrome.runtime.Port>();

/**
 * Open the offscreen document unless it's already open.
 *
 * @returns Resolves once the document is ready for messages.
 */
async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  // Concurrent requests share one creation; Chrome allows only one document
  opening ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Runs DataFog Core and the FogVault Worker.",
    })
    .finally(() => {
      opening = undefined;
    });
  await opening;
}

/**
 * An error carrying only a code, as every response does.
 *
 * @param code The code.
 * @returns The error.
 */
function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/**
 * Read where the workspace lives.
 *
 * @returns The stored routing, or null if there's no vault yet.
 */
async function loadRouting(): Promise<VaultRouting | null> {
  const stored = await chrome.storage.local.get<{ vault?: VaultRouting }>(
    "vault",
  );
  return stored.vault ?? null;
}

/**
 * Throw an error response's code, so failures reach the caller as errors.
 *
 * @param response A response that may be an error.
 * @returns The response, if it isn't one.
 */
function settled<T>(response: T | ErrorResponse | undefined): T {
  if (response === undefined) throw coded("no_response");
  if (typeof response === "object" && response !== null && "error" in response)
    throw coded(response.error);
  return response;
}

/**
 * Pass a vault request to the offscreen document.
 *
 * @param request The request.
 * @returns Its response.
 */
interface StorageResponse<T> {
  result: T;
  storage?: { routing?: VaultRouting; migrated?: boolean; deleted?: boolean };
}
function isStorageResponse<T>(
  response: T | StorageResponse<T>,
): response is StorageResponse<T> {
  return (
    typeof response === "object" && response !== null && "result" in response
  );
}

async function forwardVault<T>(
  request: VaultRequest | OffscreenRequest["request"],
  host?: string,
): Promise<T> {
  await ensureOffscreen();
  const bootstrap = await chrome.storage.local.get<{
    settings?: Partial<Settings>;
    vaultDeleting?: boolean;
  }>(["settings", "vaultDeleting"]);
  if (bootstrap.vaultDeleting && request.type !== "vault-delete")
    throw coded("vault_deletion_incomplete");
  const forwarded: OffscreenRequest = {
    target: "offscreen",
    request,
    settings: DEFAULT_SETTINGS,
    legacySettings: bootstrap.settings,
    routing: await loadRouting(),
    host,
  };
  const response = settled<T | StorageResponse<T>>(
    await chrome.runtime.sendMessage<
      OffscreenRequest,
      T | StorageResponse<T> | ErrorResponse
    >(forwarded),
  );
  if (!isStorageResponse(response)) return response;
  const { result, storage } = response;
  try {
    if (storage?.deleted)
      await chrome.storage.local.remove(["vault", "settings", "vaultDeleting"]);
    else if (storage?.routing) {
      await chrome.storage.local.set({ vault: storage.routing });
      // The offscreen host reports migration only after ciphertext readback.
      if (storage.migrated && bootstrap.settings !== undefined)
        await chrome.storage.local.remove("settings");
    }
  } catch (error) {
    if (
      request.type === "pseudonymize" &&
      typeof result === "object" &&
      result !== null &&
      "saved" in result &&
      result.saved === true
    )
      return { ...result, warning: "metadata_cleanup_incomplete" };
    throw error;
  }
  return result;
}

/**
 * Ask a ChatGPT tab's content script something.
 *
 * @param tabId The tab.
 * @param request The request.
 * @returns Its response.
 */
async function askTab<T>(tabId: number, request: TabRequest): Promise<T> {
  return settled(
    await chrome.tabs.sendMessage<TabRequest, T | ErrorResponse>(
      tabId,
      request,
    ),
  );
}

/**
 * The active tab in a window.
 *
 * @param windowId The window.
 * @returns The tab's id.
 */
async function activeTab(windowId: number): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id === undefined) throw coded("no_chat");
  return tab.id;
}

/**
 * Restore the markers in the latest answer of the chat in a window's active
 * tab, and show the original values in place in that answer.
 *
 * @param windowId The side panel's window.
 * @returns The restored answer, and how many values show in the page.
 */
async function restoreLatest(windowId: number): Promise<RestoredInPage> {
  const tabId = await activeTab(windowId);
  let answer: string | null;
  try {
    ({ text: answer } = await askTab<{ text: string | null }>(tabId, {
      type: "latest-answer",
    }));
  } catch {
    // No content script answers outside ChatGPT
    throw coded("no_chat");
  }
  if (answer === null) throw coded("no_answer");
  const { values, ...restored } = await forwardVault<RestoredWithValues>({
    type: "restore",
    text: answer,
  });
  if (restored.restored + restored.unrestored === 0) throw coded("no_markers");
  const { shown } = await askTab<{ shown: number }>(tabId, {
    type: "show-originals",
    values,
  });
  return { ...restored, shown };
}

/**
 * Put the markers back in a window's active tab.
 *
 * @param windowId The side panel's window.
 * @returns Nothing of note.
 */
async function hideInTab(windowId: number): Promise<object> {
  await askTab(await activeTab(windowId), { type: "hide-originals" }).catch(
    () => {},
  );
  return {};
}

/** Have every tab check its chat box again, since what's skipped changed. */
async function recheckTabs(policyVersion?: string): Promise<void> {
  for (const { id } of await chrome.tabs.query({})) {
    // Tabs without DataFog's content script don't answer
    if (id !== undefined)
      await askTab(id, {
        type: "recheck",
        ...(policyVersion ? { policyVersion } : {}),
      }).catch(() => {});
  }
}

/**
 * Save an approved review and put its markers in the chat box, unless the chat
 * box changed since the review was prepared.
 *
 * @returns The vault's status afterwards.
 */
async function approveReview(): Promise<unknown> {
  await checkReviewSource();
  const saved = await forwardVault<Pseudonymized>({ type: "review-approve" });
  await applyPseudonyms(saved);
  return forwardVault({ type: "vault-status" });
}

/**
 * Save one reviewed value and put its marker in the chat box, unless the chat
 * box changed since the review was prepared, then review the values left.
 *
 * @param index The value's place in the review.
 * @returns The vault's status afterwards.
 */
async function markSensitive(index: number): Promise<unknown> {
  await checkReviewSource();
  const saved = await forwardVault<MarkedSensitive>({
    type: "review-mark-sensitive",
    index,
  });
  await applyPseudonyms(saved);
  if (saved.remaining > 0) {
    // Reviewed as the chat box now reads, with the marker in place
    const { text } = await askTab<{ text: string | null }>(saved.tabId, {
      type: "chat-text",
    });
    if (text !== null)
      await forwardVault({ type: "pseudonymize", text, tabId: saved.tabId });
  }
  return forwardVault({ type: "vault-status" });
}

/** Drop the review if its chat box no longer has the text it was found in. */
async function checkReviewSource(): Promise<void> {
  const { source } = await forwardVault<{ source: ReviewSource | null }>({
    type: "review-source",
  });
  if (!source) throw coded("no_review");
  const { text } = await askTab<{ text: string | null }>(source.tabId, {
    type: "chat-text",
  });
  if (text !== source.text) {
    await forwardVault({ type: "review-cancel" });
    throw coded("chat_box_changed");
  }
}

/**
 * Have the tab put saved markers in its chat box.
 *
 * @param saved The tab, the text they were found in, and the edits.
 */
async function applyPseudonyms(saved: Pseudonymized): Promise<void> {
  await askTab(saved.tabId, {
    type: "apply-pseudonyms",
    before: saved.text,
    response: saved.response,
  });
}

/**
 * Handle one request from the side panel.
 *
 * @param request The request.
 * @returns The response to send back.
 */
async function handlePanel(request: PanelRequest): Promise<unknown> {
  if (request.type === "review-approve") return approveReview();
  if (request.type === "review-mark-sensitive")
    return markSensitive(request.index);
  if (request.type === "restore-latest") return restoreLatest(request.windowId);
  if (request.type === "hide-originals") return hideInTab(request.windowId);
  if (request.type === "update-status") return { ready: await updateWaiting() };
  // A value marked not sensitive, or no longer, changes what open chats count
  if (
    request.type === "review-not-sensitive" ||
    request.type === "choice-clear"
  ) {
    let policyVersion: string | undefined;
    try {
      const status = await forwardVault<VaultStatus>(request);
      policyVersion = status.policyVersion;
      await chrome.storage.local.set({
        policyVersion: policyVersion ?? crypto.randomUUID(),
      });
      return status;
    } finally {
      await recheckTabs(policyVersion);
    }
  }
  if (request.type === "vault-delete") {
    await chrome.storage.local.set({ vaultDeleting: true });
    const status = await forwardVault<VaultStatus>(request);
    await recheckTabs();
    return status;
  }
  if (request.type !== "vault-create") return forwardVault(request);
  const created = await forwardVault<CreatedVault>(request);
  await chrome.storage.local.set({ vault: created.routing });
  return created.status;
}

/**
 * Whether a message came from one of this extension's own pages, such as the
 * side panel, rather than a content script in a web page.
 *
 * @param sender The message's sender.
 * @returns True for an extension page.
 */
function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  // The side panel has no tab
  if (sender.tab === undefined)
    return sender.url?.startsWith(chrome.runtime.getURL("")) === true;
  // The settings and welcome pages open in tabs and use the vault from there
  const page = sender.url?.split(/[?#]/)[0];
  return (
    page === chrome.runtime.getURL("options.html") ||
    page === chrome.runtime.getURL("welcome.html")
  );
}

const PANEL_REQUESTS = new Set<string>([
  "vault-status",
  "update-status",
  "vault-create",
  "vault-unlock",
  "vault-lock",
  "vault-delete",
  "device-forget",
  "review-approve",
  "review-cancel",
  "review-mark-sensitive",
  "review-not-sensitive",
  "choice-clear",
  "restore-latest",
  "hide-originals",
]);

/**
 * Whether a request is one only the side panel may send.
 *
 * @param request The request.
 * @returns True for a side panel request.
 */
function isPanelRequest(
  request: Request | PanelRequest,
): request is PanelRequest {
  return PANEL_REQUESTS.has(request.type);
}

/**
 * The host of a page that sent a request.
 *
 * @param url The page's address, if known.
 * @returns Its host, or undefined if there's no address.
 */
function hostOf(url?: string): string | undefined {
  return url ? new URL(url).hostname : undefined;
}

/**
 * Handle one request from a content script.
 *
 * @param request The request.
 * @param tab The sending tab, if any.
 * @param host The sending page's host, which sets whether checking is on.
 * @returns The response to send back.
 */
async function handle(
  request: Request,
  tab?: chrome.tabs.Tab,
  host?: string,
): Promise<unknown> {
  const tabId = tab?.id;
  if (request.type === "pseudonymize") {
    if (!tab || tabId === undefined) throw coded("no_tab");
    return forwardVault(
      {
        type: "pseudonymize",
        text: request.text,
        tabId,
        ...(request.previewId ? { previewId: request.previewId } : {}),
      },
      host,
    );
  }
  if (request.type === "settings-get") return forwardVault(request, host);
  if (request.type === "settings-save" || request.type === "always-allow") {
    let policyVersion: string | undefined;
    try {
      const result = await forwardVault<{ saved: true; policyVersion: string }>(
        request,
        host,
      );
      policyVersion = result.policyVersion;
      await chrome.storage.local.set({ policyVersion });
      return result;
    } finally {
      await recheckTabs(policyVersion);
    }
  }
  if (request.type === "restore") return forwardVault(request, host);
  if (request.type === "open-panel") {
    const panel = tab && panels.get(tab.windowId);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a port, not a window
    if (panel) panel.postMessage("close");
    // Called before any await, so Chrome still sees the user's click
    else if (tabId !== undefined) await chrome.sidePanel.open({ tabId });
    return {};
  }
  if (request.type === "protection") {
    // A broken page may be fixed by an update that's waiting to install
    const updateReady = !request.protected && (await updateWaiting());
    // Toolbar "!" when the chat box can't be found (the page isn't protected)
    await chrome.action.setBadgeText({
      tabId,
      text: request.protected ? "" : "!",
    });
    await chrome.action.setTitle({
      tabId,
      title: request.protected
        ? "Open DataFog"
        : updateReady
          ? NO_CHAT_BOX_UPDATE
          : NO_CHAT_BOX,
    });
    return { updateReady };
  }

  if (request.type === "block-sends") {
    return {
      blockSends: blockingSends(
        await forwardVault<Settings>({ type: "settings-get" }, host),
      ),
    };
  }

  if (request.type === "scan") return forwardVault({ ...request, tabId }, host);
  return forwardVault(request, host);
}

// Registered synchronously, as Manifest V3 requires
chrome.runtime.onMessage.addListener(
  (
    request: Request | PanelRequest | OffscreenRequest | PanelNotice,
    sender,
    respond,
  ) => {
    // The vault's notices to the side panel also say when it locked

    // Messages for the offscreen document or the side panel aren't for us
    if ("target" in request) return false;
    let pending: Promise<unknown>;
    if (!isPanelRequest(request))
      pending = handle(request, sender.tab, hostOf(sender.url));
    else if (fromExtensionPage(sender)) pending = handlePanel(request);
    else pending = Promise.reject(coded("not_allowed"));
    pending.then(respond, (error) => {
      const response = toError(error);
      // The code only: an error's message can quote prompt text
      console.warn(`DataFog ${request.type} failed: ${response.error}`);
      respond(response);
    });
    return true;
  },
);

// Saved for pages and the side panel, since this worker may stop before they ask
chrome.runtime.onUpdateAvailable.addListener(({ version }) => {
  void chrome.storage.local.set({ [PENDING_UPDATE]: version });
  const notice: PanelNotice = { target: "panel", type: "update-ready" };
  // No panel open means no one to tell
  chrome.runtime.sendMessage(notice).catch(() => {});
});

// A panel connects when it opens, naming its window, and drops when it closes
chrome.runtime.onConnect.addListener((port) => {
  const windowId = Number(port.name);
  panels.set(windowId, port);
  port.onDisconnect.addListener(() => panels.delete(windowId));
});

// The toolbar icon opens the side panel; settings are linked from there
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

/**
 * Run the content script in chat tabs that were open before install or an
 * update; Chrome only runs it on pages that load afterwards. A tab that
 * already has a live copy keeps it (see single.ts).
 *
 * @returns The tabs it couldn't reach, which need a reload instead.
 */
async function protectOpenTabs(): Promise<number[]> {
  const matches = chrome.runtime.getManifest().content_scripts?.[0]?.matches;
  if (!matches?.length) return [];
  const tabs = await chrome.tabs.query({ url: matches });
  const unreached: number[] = [];
  await Promise.all(
    tabs.map(async ({ id, discarded }) => {
      // A discarded tab reloads when it's next shown, and gets it then
      if (id === undefined || discarded) return;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: id },
          files: ["content.js"],
        });
      } catch {
        unreached.push(id);
      }
    }),
  );
  return unreached;
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void (async () => {
    const unreached = await protectOpenTabs().catch(() => []);
    await chrome.storage.local.set({ [UNREACHED_TABS]: unreached });
    // Welcome only a new install: never an update or a reload
    if (reason === "install")
      await chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  })();
});
