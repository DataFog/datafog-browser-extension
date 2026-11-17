/**
 * Options page: what to detect, an allowlist, a deny list, and an on/off
 * switch per site.
 */

import {
  DEFAULT_ENTITIES,
  LABELS,
  OPT_IN_ENTITIES,
  loadSettings,
  saveSettings,
} from "./settings";
import { SITE_NAMES } from "./site";

const sites = document.querySelector<HTMLFieldSetElement>("#sites")!;
const blockSends = document.querySelector<HTMLInputElement>("#block-sends")!;
const allowlist = document.querySelector<HTMLTextAreaElement>("#allowlist")!;
const denylist = document.querySelector<HTMLTextAreaElement>("#denylist")!;
const status = document.querySelector<HTMLSpanElement>("#status")!;

/** What a type may get wrong: why it's off by default, or its limits. */
const HINTS: Record<string, string> = {
  ACCOUNT_NUMBER: "only after a label such as Account number:",
  STREET_ADDRESS: "only after a label such as Shipping address:",
  PERSON: "may miss some, or flag well-known names",
  ADDRESS: "may miss some, mostly tuned for statements",
  PHONE: "may flag order or account numbers",
  DATE: "may flag timestamps",
  ZIP_CODE: "may flag any 5-digit number",
  IP_ADDRESS: "common in logs and config files",
  UUID: "common as record and request IDs",
};

/**
 * Add one checkbox per entity type, with a hint on the noisy ones.
 *
 * @param list Where the checkboxes go.
 * @param types The entity types, in display order.
 * @param selected The types currently on.
 */
function renderTypes(
  list: HTMLElement,
  types: string[],
  selected: string[],
): void {
  for (const type of types) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = type;
    box.checked = selected.includes(type);
    label.append(box, ` ${LABELS[type] ?? type}`);

    if (HINTS[type]) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = `(${HINTS[type]})`;
      label.append(hint);
    }
    list.append(label);
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
  renderTypes(
    document.getElementById("types")!,
    [...DEFAULT_ENTITIES, ...OPT_IN_ENTITIES],
    settings.entities,
  );
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
