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
const blockSends = document.querySelector<HTMLInputElement>("#block-sends")!;
const allowlist = document.querySelector<HTMLTextAreaElement>("#allowlist")!;
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

/** Fill the form from saved settings. */
async function render(): Promise<void> {
  const settings = await loadSettings();
  enabled.checked = settings.enabled;
  blockSends.checked = settings.blockSends;
  allowlist.value = settings.allowlist.join("\n");
  renderTypes(
    document.getElementById("types")!,
    [...DEFAULT_ENTITIES, ...OPT_IN_ENTITIES],
    settings.entities,
  );
}

/** Save the form. */
async function save(): Promise<void> {
  const entities = [
    ...document.querySelectorAll<HTMLInputElement>("fieldset input:checked"),
  ].map((box) => box.value);
  const values = allowlist.value
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  await saveSettings({
    enabled: enabled.checked,
    entities,
    allowlist: [...new Set(values)],
    blockSends: blockSends.checked,
  });
  status.textContent = "Saved";
  window.setTimeout(() => (status.textContent = ""), 1500);
}

document.querySelector("#save")!.addEventListener("click", () => void save());
void render();
