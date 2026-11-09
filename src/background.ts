/**
 * Service worker: keeps the offscreen document open and passes the content
 * script's requests to it. Core runs there, since Chrome stops this worker
 * when idle.
 */

import {
  NO_CHAT_BOX,
  toError,
  type CreatedVault,
  type ErrorResponse,
  type OffscreenRequest,
  type PanelNotice,
  type PanelRequest,
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
import { blockingSends, loadSettings } from "./settings";

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
async function forwardVault<T>(request: VaultRequest): Promise<T> {
  await ensureOffscreen();
  const forwarded: OffscreenRequest = {
    target: "offscreen",
    request,
    settings: await loadSettings(),
    routing: await loadRouting(),
  };
  return settled(
    await chrome.runtime.sendMessage<OffscreenRequest, T | ErrorResponse>(
      forwarded,
    ),
  );
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

/** Once the vault locks, put the markers back in every tab. */
async function hideIfLocked(): Promise<void> {
  const { state } = await forwardVault<VaultStatus>({ type: "vault-status" });
  if (state === "unlocked") return;
  for (const { id } of await chrome.tabs.query({})) {
    // Tabs without DataFog's content script don't answer
    if (id !== undefined)
      await askTab(id, { type: "hide-originals" }).catch(() => {});
  }
}

/**
 * Save an approved review and put its markers in the chat box, unless the chat
 * box changed since the review was prepared.
 *
 * @returns The vault's status afterwards.
 */
async function approveReview(): Promise<unknown> {
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
  const saved = await forwardVault<Pseudonymized>({ type: "review-approve" });
  await askTab(saved.tabId, {
    type: "apply-pseudonyms",
    before: saved.text,
    response: saved.response,
  });
  return forwardVault({ type: "vault-status" });
}

/**
 * Handle one request from the side panel.
 *
 * @param request The request.
 * @returns The response to send back.
 */
async function handlePanel(request: PanelRequest): Promise<unknown> {
  if (request.type === "review-approve") return approveReview();
  if (request.type === "restore-latest") return restoreLatest(request.windowId);
  if (request.type === "hide-originals") return hideInTab(request.windowId);
  if (request.type === "vault-reset") {
    const status = await forwardVault<VaultStatus>(request);
    await chrome.storage.local.remove("vault");
    return status;
  }
  if (request.type !== "vault-create") return forwardVault(request);
  const created = await forwardVault<CreatedVault>(request);
  await chrome.storage.local.set({ vault: created.routing });
  return { status: created.status, recoveryKey: created.recoveryKey };
}

/**
 * Whether a message came from one of this extension's own pages, such as the
 * side panel, rather than a content script in a web page.
 *
 * @param sender The message's sender.
 * @returns True for an extension page.
 */
function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.tab === undefined &&
    sender.url?.startsWith(chrome.runtime.getURL("")) === true
  );
}

const PANEL_REQUESTS = new Set<string>([
  "vault-status",
  "vault-create",
  "vault-unlock",
  "vault-lock",
  "vault-reset",
  "review-approve",
  "review-cancel",
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
 * Handle one request from a content script.
 *
 * @param request The request.
 * @param tab The sending tab, if any.
 * @returns The response to send back.
 */
async function handle(
  request: Request,
  tab?: chrome.tabs.Tab,
): Promise<unknown> {
  const tabId = tab?.id;
  if (request.type === "pseudonymize") {
    if (!tab || tabId === undefined) throw coded("no_tab");
    // Opened before any await, so Chrome still sees the user's click
    if (!panels.has(tab.windowId)) await chrome.sidePanel.open({ tabId });
    return forwardVault({ type: "pseudonymize", text: request.text, tabId });
  }
  if (request.type === "open-panel") {
    const panel = tab && panels.get(tab.windowId);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a port, not a window
    if (panel) panel.postMessage("close");
    // Called before any await, so Chrome still sees the user's click
    else if (tabId !== undefined) await chrome.sidePanel.open({ tabId });
    return {};
  }
  if (request.type === "protection") {
    // Toolbar "!" when the chat box can't be found (the page isn't protected)
    await chrome.action.setBadgeText({
      tabId,
      text: request.protected ? "" : "!",
    });
    await chrome.action.setTitle({
      tabId,
      title: request.protected ? "Open DataFog" : NO_CHAT_BOX,
    });
    return {};
  }

  if (request.type === "block-sends") {
    return { blockSends: blockingSends(await loadSettings()) };
  }

  await ensureOffscreen();
  const forwarded: OffscreenRequest = {
    target: "offscreen",
    request,
    settings: await loadSettings(),
  };
  return chrome.runtime.sendMessage(forwarded);
}

// Registered synchronously, as Manifest V3 requires
chrome.runtime.onMessage.addListener(
  (
    request: Request | PanelRequest | OffscreenRequest | PanelNotice,
    sender,
    respond,
  ) => {
    // The vault's notices to the side panel also say when it locked
    if ("target" in request && request.target === "panel")
      void hideIfLocked().catch(() => {});
    // Messages for the offscreen document or the side panel aren't for us
    if ("target" in request) return false;
    let pending: Promise<unknown>;
    if (!isPanelRequest(request)) pending = handle(request, sender.tab);
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

// A panel connects when it opens, naming its window, and drops when it closes
chrome.runtime.onConnect.addListener((port) => {
  const windowId = Number(port.name);
  panels.set(windowId, port);
  port.onDisconnect.addListener(() => panels.delete(windowId));
});

// The toolbar icon opens the side panel; settings are linked from there
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
