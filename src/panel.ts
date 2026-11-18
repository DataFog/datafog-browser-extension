/** Independent saved-data, policy, and preferences sidebar. */
import type {
  ErrorResponse,
  PanelNotice,
  PanelRequest,
  RestoredWithValues,
  VaultStatus,
} from "./messages";
import {
  addToList,
  LABELS,
  loadSettings,
  removeFromList,
  type ListName,
} from "./settings";
import { icon, isIconName, setIconButton } from "./icons";
import { LOGO } from "./logo";
import { followTheme } from "./theme";

const element = (id: string) => document.getElementById(id)!;
const status = element("vault-state");
const error = element("vault-error");
const saved = element("save-status");
let activeView: "data" | "rules" = "data";
let access: "initializing" | "ready" | "unavailable" = "initializing";
let renderVersion = 0;
/** How long "Saved" shows, in ms. */
const SAVED_MS = 2000;
let savedTimer = 0;
let busy = false;

followTheme(document.documentElement);

// Icons are declared in the markup with data-icon and drawn once here
for (const target of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  const name = target.dataset.icon;
  if (isIconName(name))
    target.insertAdjacentHTML(
      "afterbegin",
      icon(name, target.tagName === "H2" ? 14 : 16),
    );
}
document.getElementById("brand")?.insertAdjacentHTML("afterbegin", LOGO);

/** Explanations live behind info buttons instead of under every heading. */
function toggleInfo(button: HTMLElement, id: string): void {
  const info = document.getElementById(id);
  if (!info) return;
  info.hidden = !info.hidden;
  button.setAttribute("aria-expanded", String(!info.hidden));
}
for (const button of document.querySelectorAll<HTMLElement>("[data-info]")) {
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", button.dataset.info!);
  button.addEventListener("click", () =>
    toggleInfo(button, button.dataset.info!),
  );
}
const chip = element("vault-chip");
chip.addEventListener("click", () => toggleInfo(chip, "vault-info"));

function failure(code: string): void {
  error.hidden = false;
  error.textContent = `Your vault couldn't open. Nothing was lost. (${code})`;
}
async function ask<T>(
  request: PanelRequest | { type: "restore"; text: string },
): Promise<T | ErrorResponse> {
  try {
    return (
      (await chrome.runtime.sendMessage(request)) ?? { error: "no_response" }
    );
  } catch {
    return { error: "extension_reloaded" };
  }
}
function selectView(view: typeof activeView): void {
  activeView = view;
  for (const section of document.querySelectorAll<HTMLElement>(
    "[data-section]",
  ))
    section.hidden = section.dataset.section !== view;
  for (const button of document.querySelectorAll<HTMLElement>("[data-view]"))
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
}
for (const button of document.querySelectorAll<HTMLElement>("[data-view]"))
  button.addEventListener(
    "click",
    () =>
      (button.dataset.view === "data" || button.dataset.view === "rules") &&
      selectView(button.dataset.view),
  );

interface RowDetail {
  /** A small uppercase label above the value, such as its type. */
  kicker?: string;
  /** The token that stands in for the value in chats. */
  token?: string;
  /** Where a rule applies: "Any type" or one detected type. */
  scope?: string;
}
function row(
  value: string,
  detail: RowDetail = {},
  remove?: () => Promise<void>,
): HTMLLIElement {
  const item = document.createElement("li");
  const text = document.createElement("div");
  text.className = "value";
  if (detail.kicker) {
    const kicker = document.createElement("span");
    kicker.className = "kicker";
    kicker.textContent = detail.kicker;
    text.append(kicker);
  }
  text.append(value);
  item.append(text);
  if (detail.token) {
    const token = document.createElement("span");
    token.className = "token";
    token.title = detail.token;
    token.textContent = detail.token;
    item.append(token);
  }
  if (detail.scope) {
    const scope = document.createElement("span");
    scope.className = "scope";
    scope.textContent = detail.scope;
    item.append(scope);
  }
  if (remove) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon";
    setIconButton(button, "remove", "Remove");
    button.title = `Remove ${value}`;
    button.addEventListener("click", () => void mutate(remove));
    item.append(button);
  }
  return item;
}
async function mutate(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  saved.textContent = "Saving…";
  error.hidden = true;
  try {
    await action();
    saved.textContent = "Saved";
    // A confirmation, not a section: it fades once read
    window.clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => {
      if (saved.textContent === "Saved") saved.textContent = "";
    }, SAVED_MS);
    await refresh();
  } catch {
    saved.textContent =
      "Save could not be confirmed. Retry to check the committed policy.";
  } finally {
    busy = false;
  }
}
async function refresh(): Promise<void> {
  const version = ++renderVersion;
  const response = await ask<VaultStatus>({
    type: "vault-status",
    autoUnlock: true,
  });
  if (version !== renderVersion) return;
  if ("error" in response) {
    access = "unavailable";
    failure(response.error);
    for (const id of [
      "originals",
      "not-sensitive",
      "allowlist",
      "denylist",
      "lookup-result",
    ])
      element(id).replaceChildren();
  } else {
    access = response.state === "unlocked" ? "ready" : "unavailable";
    error.hidden = true;
    element("originals").replaceChildren(
      ...(response.originals ?? []).map((item) =>
        row(item.original, {
          kicker: LABELS[item.entityType] ?? item.entityType,
          token: item.marker,
        }),
      ),
    );
    // Older tokens still restore through search, so only an empty list
    // needs words
    element("originals-note").textContent = response.originals?.length
      ? ""
      : "Nothing saved yet. Originals appear here after Replace.";
    element("not-sensitive").replaceChildren(
      ...response.notSensitive.map((choice) =>
        row(
          choice.value,
          { scope: LABELS[choice.entityType] ?? choice.entityType },
          async () => {
            const result = await ask<VaultStatus>({
              type: "choice-clear",
              ...choice,
            });
            if ("error" in result) throw new Error(result.error);
          },
        ),
      ),
    );
  }
  status.textContent = access === "ready" ? "ready" : "unavailable";
  element("vault-chip").dataset.access = access;
  element("unlocked").hidden = access !== "ready";
  element("retry-access").hidden = access !== "unavailable";
  if (access !== "ready") return;
  try {
    const settings = await loadSettings();
    if (version !== renderVersion) return;
    for (const name of ["allowlist", "denylist"] as const)
      element(name).replaceChildren(
        ...settings[name].map((value) =>
          row(value, name === "allowlist" ? { scope: "Any type" } : {}, () =>
            removeFromList(name, value),
          ),
        ),
      );
  } catch {
    failure("settings_unavailable");
  }
}
for (const name of ["allowlist", "denylist"] as ListName[])
  element(`${name}-add`).addEventListener("submit", (event) => {
    event.preventDefault();
    const field = document.querySelector<HTMLInputElement>(`#${name}-value`)!;
    const value = field.value;
    void mutate(async () => {
      await addToList(name, value);
      field.value = "";
    });
  });
element("retry-access").addEventListener("click", () => void refresh());
element("lookup").addEventListener("submit", (event) => {
  event.preventDefault();
  const text =
    document.querySelector<HTMLInputElement>("#lookup-marker")!.value;
  element("lookup-result").textContent = "Looking up…";
  void ask<RestoredWithValues>({ type: "restore", text }).then((response) => {
    element("lookup-result").textContent =
      "error" in response
        ? "Couldn't read your vault. Try again."
        : response.restored
          ? response.text
          : "No original saved for this token.";
  });
});
// Typing filters the saved list; Enter looks up tokens that aren't listed
element("lookup-marker").addEventListener("input", () => {
  const query = document
    .querySelector<HTMLInputElement>("#lookup-marker")!
    .value.trim()
    .toLowerCase();
  element("lookup-result").textContent = "";
  for (const item of element("originals").querySelectorAll("li"))
    item.hidden =
      query !== "" && !(item.textContent ?? "").toLowerCase().includes(query);
});
for (const id of ["settings", "vault-settings"])
  element(id).addEventListener("click", () => chrome.runtime.openOptionsPage());
element("update-now").addEventListener("click", () => chrome.runtime.reload());
async function checkUpdate(): Promise<void> {
  const response = await ask<{ ready?: boolean }>({ type: "update-status" });
  element("update").hidden = "error" in response || !response.ready;
}
chrome.runtime.onMessage.addListener((message: PanelNotice | object) => {
  if (!("target" in message) || message.target !== "panel") return false;
  if (message.type === "update-ready") void checkUpdate();
  else void refresh();
  return false;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ("policyVersion" in changes || "settings" in changes))
    void refresh();
});
export async function connect(): Promise<void> {
  const { id } = await chrome.windows.getCurrent();
  const port = chrome.runtime.connect({ name: String(id) });
  port.onMessage.addListener(() => window.close());
  port.onDisconnect.addListener(() => void connect());
}
void connect();
void refresh();
void checkUpdate();
