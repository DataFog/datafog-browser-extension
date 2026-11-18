/**
 * Options page: the chat sites to check, the types to look for, grouped by
 * how accurately they're found, whether to hold sends, the user's lists, and
 * the version and where to get help.
 */

import {
  LABELS,
  loadSettings,
  saveSettings,
  type Settings,
  TYPE_GROUPS,
  type TypeGroup,
} from "./settings";
import { SITE_NAMES } from "./site";

const sites = document.querySelector<HTMLFieldSetElement>("#sites")!;
const blockSends = document.querySelector<HTMLInputElement>("#block-sends")!;
const allowlist = document.querySelector<HTMLTextAreaElement>("#allowlist")!;
const denylist = document.querySelector<HTMLTextAreaElement>("#denylist")!;
const status = document.querySelector<HTMLSpanElement>("#status")!;

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
  blockSends.checked = settings.blockSends;
  allowlist.value = settings.allowlist.join("\n");
  denylist.value = settings.denylist.join("\n");
  renderTypes(document.getElementById("types")!, settings.entities);
}

/**
 * The distinct, nonblank lines of a list.
 *
 * @param list The text box holding one item per line.
 * @returns Each item once, trimmed.
 */
function linesOf(list: HTMLTextAreaElement): string[] {
  const items = list.value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(items)];
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

/** How long after typing stops a list is saved, in ms. */
const LIST_SAVE_MS = 400;

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
  if (control === blockSends) return { blockSends: blockSends.checked };
  if (control === allowlist) return { allowlist: linesOf(allowlist) };
  if (control === denylist) return { denylist: linesOf(denylist) };
  if (!(control instanceof HTMLInputElement)) return null;
  if (sites.contains(control))
    return { off: valuesOf("#sites input:not(:checked)") };
  return { entities: valuesOf("#types input:checked") };
}

/** Lists typed in but not yet saved, each with its timer. */
const pending = new Map<HTMLTextAreaElement, number>();

/**
 * Save a list now, if it's waiting to be saved.
 *
 * @param list The list's text box.
 */
function flush(list: HTMLTextAreaElement): void {
  if (!pending.has(list)) return;
  window.clearTimeout(pending.get(list));
  pending.delete(list);
  void save(changeFrom(list)!);
}

// Checkboxes save right away, lists once typing stops or the box loses focus
document.addEventListener("change", (event) => {
  if (event.target instanceof HTMLTextAreaElement) flush(event.target);
  else {
    const change = changeFrom(event.target);
    if (change) void save(change);
  }
});
for (const list of [allowlist, denylist]) {
  list.addEventListener("input", () => {
    window.clearTimeout(pending.get(list));
    pending.set(
      list,
      window.setTimeout(() => flush(list), LIST_SAVE_MS),
    );
  });
}
// Don't lose a list typed just before the page closes
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden")
    for (const list of pending.keys()) flush(list);
});

/** Show lists changed in the side panel, unless the user is editing them. */
async function refreshLists(): Promise<void> {
  const settings = await loadSettings();
  for (const [list, items] of [
    [allowlist, settings.allowlist],
    [denylist, settings.denylist],
  ] as const) {
    if (list === document.activeElement || pending.has(list)) continue;
    list.value = items.join("\n");
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "settings" in changes) void refreshLists();
});

void render();
