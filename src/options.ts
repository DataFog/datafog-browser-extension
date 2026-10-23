/**
 * Options page: what to detect, an allowlist, and an on/off switch.
 */

import {
  DEFAULT_ENTITIES,
  LABELS,
  OPT_IN_ENTITIES,
  loadSettings,
  saveSettings,
} from "./settings";

const enabled = document.querySelector<HTMLInputElement>("#enabled")!;
const allowlist = document.querySelector<HTMLTextAreaElement>("#allowlist")!;
const status = document.querySelector<HTMLSpanElement>("#status")!;

/** Why a type is off by default: it also matches ordinary numbers. */
const HINTS: Record<string, string> = {
  PHONE: "may flag order or account numbers",
  DATE: "may flag timestamps",
  ZIP_CODE: "may flag any 5-digit number",
  IP_ADDRESS: "common in logs and config files",
};

/**
 * Add one checkbox per entity type, with a hint on the noisy ones.
 *
 * @param types The entity types, in display order.
 * @param selected The types currently on.
 */
function renderTypes(types: string[], selected: string[]): void {
  const list = document.getElementById("types")!;
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

/** Fill the form from saved settings. */
async function render(): Promise<void> {
  const settings = await loadSettings();
  enabled.checked = settings.enabled;
  allowlist.value = settings.allowlist.join("\n");
  renderTypes([...DEFAULT_ENTITIES, ...OPT_IN_ENTITIES], settings.entities);
}

/** Save the form. */
async function save(): Promise<void> {
  const entities = [...document.querySelectorAll<HTMLInputElement>("fieldset input:checked")].map(
    (box) => box.value,
  );
  const values = allowlist.value
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  await saveSettings({ enabled: enabled.checked, entities, allowlist: [...new Set(values)] });
  status.textContent = "Saved";
  window.setTimeout(() => (status.textContent = ""), 1500);
}

document.querySelector("#save")!.addEventListener("click", () => void save());
void render();
