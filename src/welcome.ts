/**
 * The welcome page, opened once on a new install: pin datafog, reload any
 * chat tab the service worker couldn't reach, then show where datafog
 * lives. See welcome-state.ts
 * for the flow.
 */

import { icon, isIconName } from "./icons";
import { LOGO } from "./logo";
import type { ErrorResponse, VaultStatus } from "./messages";
import { followTheme } from "./theme";
import { HOSTS } from "./site";
import { welcomeMedia } from "./welcome-media";
import {
  ONBOARDED,
  UNREACHED_TABS,
  welcomeSteps,
  welcomeTarget,
  type WelcomeStep,
} from "./welcome-state";

followTheme(document.documentElement);
for (const target of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  const name = target.dataset.icon;
  if (isIconName(name))
    target.insertAdjacentHTML(
      "afterbegin",
      icon(name, target.tagName === "SPAN" ? 14 : 20),
    );
}
for (const target of document.querySelectorAll<HTMLElement>(
  "[data-icon-after]",
)) {
  const name = target.dataset.iconAfter;
  if (isIconName(name)) target.insertAdjacentHTML("beforeend", icon(name, 14));
}
document.getElementById("mark")?.insertAdjacentHTML("afterbegin", LOGO);

const element = (id: string) => document.getElementById(id)!;

async function ask<T>(request: object): Promise<T | ErrorResponse> {
  try {
    return (
      (await chrome.runtime.sendMessage(request)) ?? { error: "no_response" }
    );
  } catch {
    return { error: "extension_reloaded" };
  }
}

const walkthrough = welcomeMedia(element("walkthrough"));

let steps: WelcomeStep[] = ["pin", "done"];
let index = 0;
let pinTimer = 0;
let vaultReady = false;
let tabs: chrome.tabs.Tab[] = [];

function show(next: number): void {
  index = Math.min(next, steps.length - 1);
  const step = steps[index];
  for (const section of document.querySelectorAll<HTMLElement>("[data-step]"))
    section.hidden = section.dataset.step !== step;
  const heading = document.querySelector<HTMLElement>(
    `[data-step="${step}"] h1`,
  );
  if (heading) {
    heading.id = `welcome-${step}-title`;
    document
      .querySelector(".dialog")!
      .setAttribute("aria-labelledby", heading.id);
  }
  // The last screen is a summary, not a numbered step
  const numbered = steps.length - 1;
  // One step needs no counting
  element("step-label").textContent =
    step === "done"
      ? "All set"
      : numbered === 1
        ? "Welcome"
        : `Step ${index + 1} of ${numbered}`;
  element("step-dots").replaceChildren(
    ...steps.slice(0, numbered > 1 ? numbered : 0).map((_, at) => {
      const dot = document.createElement("span");
      dot.className = at < index ? "past" : at === index ? "now" : "";
      return dot;
    }),
  );
  window.clearInterval(pinTimer);
  if (step === "pin") watchPin();
  if (step === "done") renderVaultLine();
  walkthrough.setVisible(step === "done");
  (
    document.querySelector<HTMLElement>(`[data-step="${step}"] .primary`) ??
    document.querySelector<HTMLElement>(`[data-step="${step}"] button`)
  )?.focus();
}

function renderVaultLine(): void {
  element("vault-line").innerHTML = icon("lock", 13);
  element("vault-line").append(
    vaultReady
      ? " Your vault is ready, encrypted on this device."
      : " Setting up your vault…",
  );
}

/** Show whether datafog is pinned. */
async function checkPin(): Promise<void> {
  try {
    const { isOnToolbar } = await chrome.action.getUserSettings();
    const status = element("pin-status");
    status.classList.toggle("ok", isOnToolbar);
    status.innerHTML = isOnToolbar ? icon("check", 14) : "";
    status.append(isOnToolbar ? " Pinned" : "");
  } catch {
    // Older Chrome: no pin status, and Next still works
  }
}

/**
 * Chrome says whether datafog is pinned but not when that changes, so look
 * again every second while this step shows.
 */
function watchPin(): void {
  void checkPin();
  pinTimer = window.setInterval(() => void checkPin(), 1000);
}

function finish(): void {
  void chrome.storage.local.set({ [ONBOARDED]: true }).catch(() => {});
}

for (const button of document.querySelectorAll<HTMLElement>("[data-next]"))
  button.addEventListener("click", () => show(index + 1));

element("reload-go").addEventListener("click", () => {
  for (const box of document.querySelectorAll<HTMLInputElement>(
    "#reload-list input:checked",
  ))
    void chrome.tabs.reload(Number(box.value)).catch(() => {});
  show(index + 1);
});

element("done-close").addEventListener("click", () => {
  finish();
  void chrome.tabs
    .getCurrent()
    .then(async (tab) => {
      if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
    })
    .catch(() => window.close());
});
element("done-try").addEventListener("click", finish);

function listTabs(): void {
  element("reload-list").replaceChildren(
    ...tabs.map((tab) => {
      const item = document.createElement("li");
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = true;
      box.value = String(tab.id);
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = tab.title || "Chat";
      const host = document.createElement("span");
      host.className = "host";
      host.textContent = tab.url ? new URL(tab.url).hostname : "";
      label.append(box, title, host);
      item.append(label);
      return item;
    }),
  );
  element("reload-go").textContent =
    tabs.length === 1 ? "Reload 1 tab" : `Reload ${tabs.length} tabs`;
}

/** Read the vault's status, and look again for a while until it's ready. */
async function checkVault(attempt = 0): Promise<void> {
  const status = await ask<VaultStatus>({
    type: "vault-status",
    autoUnlock: true,
  });
  vaultReady = !("error" in status) && status.state === "unlocked";
  if (steps[index] === "done") renderVaultLine();
  if (!vaultReady && attempt < 10)
    window.setTimeout(() => void checkVault(attempt + 1), 1000);
}

async function start(): Promise<void> {
  const open = await chrome.tabs
    .query({ url: HOSTS.map((host) => `https://${host}/*`) })
    .catch(() => []);
  const target = welcomeTarget(open);
  const link = document.querySelector<HTMLAnchorElement>("#done-try")!;
  link.href = target.url;
  link.replaceChildren(`Try it on ${target.name}`);
  link.insertAdjacentHTML("beforeend", icon("arrow", 14));
  const stored = await chrome.storage.local
    .get(UNREACHED_TABS)
    .catch((): Record<string, unknown> => ({}));
  const ids: unknown = stored[UNREACHED_TABS];
  const found = await Promise.all(
    (Array.isArray(ids) ? ids : [])
      .filter((id): id is number => typeof id === "number")
      .map((id) => chrome.tabs.get(id).catch(() => null)),
  );
  tabs = found.filter((tab): tab is chrome.tabs.Tab => tab !== null);
  listTabs();
  await checkVault();
  // Keep the user where they are if they moved on while this loaded
  const current = steps[index];
  steps = welcomeSteps({ reload: tabs.length > 0 });
  show(Math.max(0, steps.indexOf(current)));
}

show(0);
void start();
