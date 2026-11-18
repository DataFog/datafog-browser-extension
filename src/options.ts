/**
 * Options page: the chat sites to check, the types to look for, grouped by
 * how accurately they're found, whether to hold sends, and the user's lists.
 */

import {
  LABELS,
  loadSettings,
  saveSettings,
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

/** Save the form. */
async function save(): Promise<void> {
  const entities = [
    ...document.querySelectorAll<HTMLInputElement>("#types input:checked"),
  ].map((box) => box.value);
  const off = [
    ...sites.querySelectorAll<HTMLInputElement>("input:not(:checked)"),
  ].map((box) => box.value);

  await saveSettings({
    enabled: true,
    off,
    entities,
    allowlist: linesOf(allowlist),
    denylist: linesOf(denylist),
    blockSends: blockSends.checked,
  });
  status.textContent = "Saved";
  window.setTimeout(() => (status.textContent = ""), 1500);
}

document.querySelector("#save")!.addEventListener("click", () => void save());
void render();
