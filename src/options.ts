/**
 * Options page: the chat sites to check, the types to look for, grouped by
 * how accurately they're found, whether to hold sends, the user's lists, and
 * the version and where to get help.
 */

import {
  DEFAULT_SETTINGS,
  LABELS,
  loadSettings,
  saveSettings,
  type Settings,
  TYPE_GROUPS,
  type TypeGroup,
} from "./settings";
import { icon, isIconName } from "./icons";
import { LOGO } from "./logo";
import type { ErrorResponse, VaultStatus } from "./messages";
import { SITE_NAMES } from "./site";
import {
  currentTheme,
  followTheme,
  saveTheme,
  THEME_KEY,
  type Theme,
} from "./theme";

const sites = document.querySelector<HTMLFieldSetElement>("#sites")!;
const autoReplaceOnPaste = document.querySelector<HTMLInputElement>(
  "#auto-replace-on-paste",
)!;
const blockSends = document.querySelector<HTMLInputElement>("#block-sends")!;
const detector = document.querySelector<HTMLSelectElement>("#detector");
const status = document.querySelector<HTMLSpanElement>("#status")!;

followTheme(document.documentElement);

// Icons are declared in the markup with data-icon and drawn once here
for (const target of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  const name = target.dataset.icon;
  if (isIconName(name)) target.insertAdjacentHTML("afterbegin", icon(name, 16));
}
document.getElementById("brand")?.insertAdjacentHTML("afterbegin", LOGO);

/**
 * A group's heading, with more about it in a tooltip on hover or focus.
 *
 * @param group The group.
 * @param id The tooltip's id.
 * @returns The heading.
 */
function groupLegend(group: TypeGroup, id: string): HTMLLegendElement {
  const legend = document.createElement("legend");
  const info = document.createElement("span");
  info.className = "info";
  info.tabIndex = 0;
  info.textContent = "?";
  info.setAttribute("aria-describedby", id);
  info.setAttribute("aria-label", `About ${group.name}`);
  const tip = document.createElement("span");
  tip.id = id;
  tip.setAttribute("role", "tooltip");
  tip.textContent = group.about;
  legend.append(group.name, " ", info, tip);
  return legend;
}

/**
 * Add one checkbox per entity type, grouped by how accurately each is found.
 *
 * @param list Where the groups go.
 * @param selected The types currently on.
 */
function renderTypes(list: HTMLElement, selected: string[]): void {
  for (const [index, group] of TYPE_GROUPS.entries()) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "group";
    fieldset.append(groupLegend(group, `group-${index}`));
    for (const type of group.types) {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = type;
      box.checked = selected.includes(type);
      label.append(box, ` ${LABELS[type] ?? type}`);
      fieldset.append(label);
    }
    list.append(fieldset);
  }
}

/**
 * Add one checkbox per chat site, checked while DataFog checks it.
 *
 * @param off The hosts checking is turned off for.
 */
function renderSites(off: string[]): void {
  for (const { host, name } of SITE_NAMES) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = `site-${name.toLowerCase()}`;
    box.value = host;
    box.checked = !off.includes(host);
    label.append(box, ` ${name}`);
    sites.append(label);
  }
}

/** Fill the form from saved settings. */
async function render(): Promise<void> {
  document.querySelector("#version")!.textContent =
    `version ${chrome.runtime.getManifest().version}`;
  const settings = await loadSettings();
  renderSites(settings.off);
  if (detector) detector.value = settings.detector ?? "rampart";
  blockSends.checked = settings.blockSends;
  autoReplaceOnPaste.checked = settings.autoReplaceOnPaste;
  for (const radio of document.querySelectorAll<HTMLInputElement>(
    'input[name="theme"]',
  ))
    radio.checked = radio.value === currentTheme();
  renderTypes(document.getElementById("types")!, settings.entities);
}

/**
 * The values of a group's checkboxes, checked or not.
 *
 * @param selector The checkboxes.
 * @returns Their values.
 */
function valuesOf(selector: string): string[] {
  return [...document.querySelectorAll<HTMLInputElement>(selector)].map(
    (box) => box.value,
  );
}

/** How long "Saved" shows, in ms. */
const SAVED_MS = 1500;

let statusTimer = 0;

/**
 * Say whether a change was saved, for a moment.
 *
 * @param text What happened.
 */
function showStatus(text: string): void {
  status.textContent = text;
  status.classList.toggle("failed", text !== "Saved");
  window.clearTimeout(statusTimer);
  if (text === "Saved")
    statusTimer = window.setTimeout(() => (status.textContent = ""), SAVED_MS);
}

/** The saves under way, run one at a time so none undoes another. */
let saving = Promise.resolve();

/**
 * Save one change, leaving the rest as saved, since the side panel may have
 * changed a list since this page loaded.
 *
 * @param change The settings that changed.
 * @returns Once it's saved.
 */
function save(change: Partial<Settings>): Promise<void> {
  saving = saving
    .then(async () => {
      await saveSettings({ ...(await loadSettings()), ...change });
      showStatus("Saved");
    })
    // A failed save leaves the rest to run
    .catch(() => showStatus("Couldn't save. Try again."));
  return saving;
}

/**
 * The setting a form control holds, as it now stands.
 *
 * @param control The control that changed.
 * @returns The changed setting, or null for anything else.
 */
function changeFrom(control: EventTarget | null): Partial<Settings> | null {
  if (detector && control === detector)
    return { detector: detector.value === "cnn" ? "cnn" : "rampart" };
  if (control === autoReplaceOnPaste)
    return { autoReplaceOnPaste: autoReplaceOnPaste.checked };
  if (control === blockSends) return { blockSends: blockSends.checked };
  if (!(control instanceof HTMLInputElement)) return null;
  if (sites.contains(control))
    return { off: valuesOf("#sites input:not(:checked)") };
  return { entities: valuesOf("#types input:checked") };
}

const isTheme = (value: string): value is Theme =>
  value === "system" || value === "light" || value === "dark";

// Checkboxes save right away; the theme is its own local choice
document.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.name === "theme") {
    if (isTheme(target.value))
      void saveTheme(target.value)
        .then(() => showStatus("Saved"))
        .catch(() => showStatus("Couldn't save. Try again."));
    return;
  }
  const change = changeFrom(target);
  if (change) void save(change);
});

// A theme chosen in another window shows here too
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(THEME_KEY in changes)) return;
  for (const radio of document.querySelectorAll<HTMLInputElement>(
    'input[name="theme"]',
  ))
    radio.checked = radio.value === currentTheme();
});

/**
 * Put the sites, types and holding sends back as they were on install,
 * keeping the user's lists.
 */
async function restoreDefaults(): Promise<void> {
  if (
    !window.confirm(
      "Restore the default sites, types and behavior? Your rules are kept.",
    )
  )
    return;
  const {
    off,
    entities,
    blockSends: hold,
    autoReplaceOnPaste: paste,
  } = DEFAULT_SETTINGS;
  await save({
    off,
    entities,
    blockSends: hold,
    autoReplaceOnPaste: paste,
    detector: DEFAULT_SETTINGS.detector,
  });
  if (detector) detector.value = DEFAULT_SETTINGS.detector ?? "rampart";
  for (const box of document.querySelectorAll<HTMLInputElement>("#sites input"))
    box.checked = !off.includes(box.value);
  for (const box of document.querySelectorAll<HTMLInputElement>("#types input"))
    box.checked = entities.includes(box.value);
  blockSends.checked = hold;
  autoReplaceOnPaste.checked = paste;
}

document
  .querySelector("#restore")!
  .addEventListener("click", () => void restoreDefaults());

/*
 * Deleting vault data lives here, with the other lasting choices, rather
 * than in the sidebar. It needs DELETE typed, and reports a partial failure
 * as one rather than closing the form as if it worked.
 */
const deleteForm = document.querySelector<HTMLFormElement>("#delete")!;
const deleteOpen = document.querySelector<HTMLButtonElement>("#delete-open")!;
const deleteConfirm =
  document.querySelector<HTMLInputElement>("#delete-confirm")!;
const deleteSubmit =
  document.querySelector<HTMLButtonElement>("#delete-submit")!;
const deleteCancel =
  document.querySelector<HTMLButtonElement>("#delete-cancel")!;
const deleteStatus = document.querySelector<HTMLElement>("#delete-status")!;
let deletion: "idle" | "confirming" | "deleting" = "idle";
const confirmed = () => deleteConfirm.value.trim().toUpperCase() === "DELETE";

function showDelete(open: boolean): void {
  deletion = open ? "confirming" : "idle";
  deleteForm.hidden = !open;
  deleteOpen.hidden = open;
  deleteConfirm.value = "";
  deleteSubmit.disabled = true;
  if (open) deleteConfirm.focus();
  else deleteOpen.focus();
}
deleteOpen.addEventListener("click", () => {
  deleteStatus.textContent = "";
  showDelete(true);
});
deleteCancel.addEventListener("click", () => {
  if (deletion !== "deleting") showDelete(false);
});
deleteConfirm.addEventListener("input", () => {
  deleteSubmit.disabled = !confirmed();
});
deleteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (deletion !== "confirming" || !confirmed()) return;
  deletion = "deleting";
  deleteSubmit.disabled = true;
  deleteCancel.disabled = true;
  deleteStatus.textContent = "Deleting…";
  void (async () => {
    let response: VaultStatus | ErrorResponse;
    try {
      response = (await chrome.runtime.sendMessage({
        type: "vault-delete",
      })) ?? { error: "no_response" };
    } catch {
      response = { error: "extension_reloaded" };
    }
    deleteCancel.disabled = false;
    showDelete(false);
    deleteStatus.textContent =
      "error" in response
        ? `Deletion didn't finish. Some data may remain; delete again to finish. (${response.error})`
        : "vault data deleted. Placeholders already in chats can't be shown again.";
    deleteStatus.classList.toggle("warning", "error" in response);
  })();
});

void render().catch(() => {
  showStatus(
    "Settings unavailable. Open the sidebar to retry storage access or migrate existing data.",
  );
  for (const control of document.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement
    // Deleting stays available: it's how to start over from broken storage
  >(
    "input:not(#delete-confirm):not([name='theme']), button:not([id^='delete-'])",
  ))
    control.disabled = true;
});
