/**
 * Side panel: the vault, the Pseudonymize review, the values marked not
 * sensitive, restoring answers, and the lists of values to always allow or
 * flag.
 */

import type {
  ErrorResponse,
  PanelNotice,
  PanelRequest,
  RestoredInPage,
  ValueChoice,
  VaultStatus,
} from "./messages";
import {
  addToList,
  type ListAdd,
  LABELS,
  loadSettings,
  removeFromList,
  type ListName,
  type Settings,
} from "./settings";
import { siteNames } from "./site";

/** Values a list shows before it scrolls within the panel. */
const LIST_VISIBLE = 5;

/** Shortest password the vault accepts. */
const MIN_PASSWORD = 8;

/** What each error code means, for codes a user can act on. */
const EXPLAINED: Record<string, string> = {
  // FogVault's code for a password that doesn't open the vault
  Authentication: "That password isn't right.",
  chat_box_changed:
    "The chat box changed after this review was prepared. Choose Pseudonymize again.",
  nothing_found: "There's nothing to pseudonymize in the chat box.",
  no_review: "This review is gone. Choose Pseudonymize again.",
  settings_changed:
    "What DataFog checks for changed after this review was prepared. Choose Pseudonymize again.",
  no_chat: `Open a ${siteNames()} chat in this tab to restore its latest answer.`,
  no_answer: "There's no answer in this chat yet.",
  vault_locked: "Unlock your vault to restore.",
  no_markers: "There are no markers in the chat's latest answer.",
};

/** The lock's body, shared by both icons. */
const LOCK_BODY =
  '<rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />';

/** An icon for each state of a vault that exists, with its name. */
const STATE_ICONS: Record<"locked" | "unlocked", [string, string]> = {
  locked: [
    "Locked",
    `${LOCK_BODY}<path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.5" />`,
  ],
  unlocked: [
    "Unlocked",
    `${LOCK_BODY}<path d="M5 7V5a3 3 0 0 1 5.8-1.1" fill="none" stroke="currentColor" stroke-width="1.5" />`,
  ],
};

const view = {
  update: document.querySelector<HTMLDivElement>("#update")!,
  review: document.querySelector<HTMLElement>("#review")!,
  reviewNote: document.querySelector<HTMLParagraphElement>("#review-note")!,
  reviewCount: document.querySelector<HTMLParagraphElement>("#review-count")!,
  reviewItems: document.querySelector<HTMLUListElement>("#review-items")!,
  reviewButtons: document.querySelector<HTMLDivElement>("#review-buttons")!,
  reviewError: document.querySelector<HTMLParagraphElement>("#review-error")!,
  reviewStatus: document.querySelector<HTMLParagraphElement>("#review-status")!,
  approve: document.querySelector<HTMLButtonElement>("#approve")!,
  vaultState: document.querySelector<HTMLSpanElement>("#vault-state")!,
  create: document.querySelector<HTMLFormElement>("#create")!,
  createPassword: document.querySelector<HTMLInputElement>("#create-password")!,
  createConfirm: document.querySelector<HTMLInputElement>("#create-confirm")!,
  createSubmit: document.querySelector<HTMLButtonElement>("#create-submit")!,
  createRemember: document.querySelector<HTMLInputElement>("#create-remember")!,
  unlockRemember: document.querySelector<HTMLInputElement>("#unlock-remember")!,
  remembered: document.querySelector<HTMLParagraphElement>("#remembered")!,
  rememberedUntil:
    document.querySelector<HTMLSpanElement>("#remembered-until")!,
  deleteOpen: document.querySelector<HTMLButtonElement>("#delete-open")!,
  deleteForm: document.querySelector<HTMLFormElement>("#delete")!,
  deleteConfirm: document.querySelector<HTMLInputElement>("#delete-confirm")!,
  deleteSubmit: document.querySelector<HTMLButtonElement>("#delete-submit")!,
  ruleLength: document.querySelector<HTMLLIElement>("#rule-length")!,
  ruleMatch: document.querySelector<HTMLLIElement>("#rule-match")!,
  unlock: document.querySelector<HTMLFormElement>("#unlock")!,
  unlockPassword: document.querySelector<HTMLInputElement>("#unlock-password")!,
  unlocked: document.querySelector<HTMLDivElement>("#unlocked")!,
  vaultError: document.querySelector<HTMLParagraphElement>("#vault-error")!,
  restoreNote: document.querySelector<HTMLParagraphElement>("#restore-note")!,
  restoreLatest: document.querySelector<HTMLButtonElement>("#restore-latest")!,
  restored: document.querySelector<HTMLDivElement>("#restored")!,
  restoredSummary:
    document.querySelector<HTMLParagraphElement>("#restored-summary")!,
  restoreError: document.querySelector<HTMLParagraphElement>("#restore-error")!,
  notSensitiveNote: document.querySelector<HTMLParagraphElement>(
    "#not-sensitive-note",
  )!,
  notSensitive: document.querySelector<HTMLUListElement>("#not-sensitive")!,
  notSensitiveCount: document.querySelector<HTMLParagraphElement>(
    "#not-sensitive-count",
  )!,
  notSensitiveError: document.querySelector<HTMLParagraphElement>(
    "#not-sensitive-error",
  )!,
};

/** The latest restored answer, kept only for Copy until it's hidden. */
let restoredText = "";

/** Whether the delete form is open. */
let deleting = false;

/** The last status shown, to redraw after opening or closing the delete form. */
let shown: VaultStatus | null = null;

/**
 * Say what an error code means.
 *
 * @param code The code.
 * @returns A message for the user.
 */
function explain(code: string): string {
  return EXPLAINED[code] ?? `Something went wrong. Error code: ${code}`;
}

/**
 * Show an error, or clear it.
 *
 * @param target Where to show it.
 * @param code The error code, or null to clear it.
 */
function showError(target: HTMLElement, code: string | null): void {
  target.textContent = code === null ? "" : explain(code);
  target.hidden = code === null;
}

/**
 * Ask the service worker something.
 *
 * @param request The request.
 * @returns Its response, or an error code if it failed.
 */
async function ask<T>(request: PanelRequest): Promise<T | ErrorResponse> {
  try {
    const response = await chrome.runtime.sendMessage<
      PanelRequest,
      T | ErrorResponse | undefined
    >(request);
    return response ?? { error: "no_response" };
  } catch {
    return { error: "extension_reloaded" };
  }
}

/**
 * Show the vault: create, unlock or lock.
 *
 * @param state The vault's state.
 */
function renderVault(status: VaultStatus): void {
  const { state, rememberedUntil } = status;
  view.remembered.hidden = state === "none" || rememberedUntil === null;
  view.rememberedUntil.textContent = rememberedUntil
    ? `This device is remembered until ${new Date(rememberedUntil).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`
    : "";
  view.create.hidden = state !== "none";
  view.unlock.hidden = state !== "locked" || deleting;
  view.unlocked.hidden = state !== "unlocked" || deleting;
  view.deleteOpen.hidden = state === "none" || deleting;
  view.deleteForm.hidden = state === "none" || !deleting;
  view.vaultState.hidden = state === "none";
  if (state !== "none") {
    const [label, paths] = STATE_ICONS[state];
    view.vaultState.title = label;
    view.vaultState.setAttribute("aria-label", label);
    // A fixed icon of the extension's own, never page or user text
    view.vaultState.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">${paths}</svg>`;
  }
  shown = status;
}

/**
 * Open or close the delete form.
 *
 * @param open Whether to open it.
 */
function showDelete(open: boolean): void {
  deleting = open;
  view.deleteForm.reset();
  view.deleteSubmit.disabled = true;
  showError(view.vaultError, null);
  if (shown) renderVault(shown);
  if (open) view.deleteConfirm.focus();
}

/**
 * Whether the user typed the delete confirmation.
 *
 * @returns True once DELETE is typed, in any case.
 */
function deleteConfirmed(): boolean {
  return view.deleteConfirm.value.trim().toUpperCase() === "DELETE";
}

/**
 * Mark a password rule as met or not, once the user has typed something.
 *
 * @param rule The rule's list item.
 * @param met Whether it's met.
 * @param typed Whether the user has typed a password yet.
 */
function markRule(rule: HTMLLIElement, met: boolean, typed: boolean): void {
  rule.classList.toggle("met", typed && met);
  rule.classList.toggle("unmet", typed && !met);
}

/**
 * Check the new password against the rules, showing each as it's met.
 *
 * @returns Whether the password meets every rule.
 */
function checkPassword(): boolean {
  const ready = checkRules(
    view.createPassword.value,
    view.createConfirm.value,
    view.ruleLength,
    view.ruleMatch,
  );
  view.createSubmit.disabled = !ready;
  return ready;
}

/**
 * Check a new password and its confirmation, showing each rule as it's met.
 *
 * @param password The new password.
 * @param confirm Its confirmation.
 * @param lengthRule The length rule's list item.
 * @param matchRule The match rule's list item.
 * @returns Whether the password meets every rule.
 */
function checkRules(
  password: string,
  confirm: string,
  lengthRule: HTMLLIElement,
  matchRule: HTMLLIElement,
): boolean {
  const long = password.length >= MIN_PASSWORD;
  const match = password === confirm;
  markRule(lengthRule, long, password !== "");
  markRule(matchRule, match, confirm !== "");
  return long && match;
}

/**
 * Show the Pseudonymize review: each original value and its marker.
 *
 * @param status The vault's status.
 */
function renderReview({
  state,
  review,
  waiting,
  reviewError,
}: VaultStatus): void {
  view.review.hidden = review === null && !waiting && reviewError === null;
  view.reviewButtons.hidden = review === null && !waiting;
  view.approve.hidden = review === null;
  if (review)
    view.reviewNote.textContent =
      "Replace values with their markers one at a time with Mark sensitive, or all at once. They're saved in your vault so they can be restored later.";
  else if (waiting)
    view.reviewNote.textContent = `${state === "none" ? "Create" : "Unlock"} your vault below to review the values to pseudonymize.`;
  else view.reviewNote.textContent = "";
  // Values only ever go in as text, never as markup
  view.reviewItems.replaceChildren(
    ...(review ?? []).map(({ entityType, original, marker }, index) => {
      const item = document.createElement("li");
      const value = document.createElement("div");
      value.textContent = original;
      const replacement = document.createElement("div");
      replacement.className = "marker";
      replacement.textContent = `→ ${marker}`;
      const choices = document.createElement("div");
      choices.className = "choices";
      const replace = linkButton("Mark sensitive");
      replace.addEventListener("click", () => void markSensitive(index));
      const keep = linkButton("Not sensitive");
      keep.addEventListener(
        "click",
        () => void markNotSensitive(index, entityType, original),
      );
      choices.append(replace, keep);
      item.append(value, replacement, choices);
      return item;
    }),
  );
  fitList(view.reviewItems, view.reviewCount);
  showError(view.reviewError, reviewError);
}

/**
 * Make a small text button for a list row.
 *
 * @param text The button's text.
 * @returns The button.
 */
function linkButton(text: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link inline";
  button.textContent = text;
  return button;
}

/**
 * Show the values remembered as not sensitive, each with Remove.
 *
 * @param status The vault's status.
 */
function renderNotSensitive({ state, notSensitive }: VaultStatus): void {
  if (state !== "unlocked")
    view.notSensitiveNote.textContent =
      "Unlock your vault to see the values you've marked not sensitive.";
  else
    view.notSensitiveNote.textContent =
      notSensitive.length === 0 ? "No values marked not sensitive yet." : "";
  // Values only ever go in as text, never as markup
  view.notSensitive.replaceChildren(
    ...notSensitive.map((choice) => {
      const item = document.createElement("li");
      const value = document.createElement("div");
      value.textContent = choice.value;
      const type = document.createElement("div");
      type.className = "muted";
      type.textContent = LABELS[choice.entityType] ?? choice.entityType;
      const remove = linkButton("Remove");
      remove.addEventListener("click", () => void clearChoice(choice));
      item.append(value, type, remove);
      if (
        kept?.entityType === choice.entityType &&
        kept.value === choice.value
      ) {
        item.classList.add("added");
        // Shown once it's drawn, below the review
        requestAnimationFrame(() => item.scrollIntoView({ block: "nearest" }));
      }
      return item;
    }),
  );
  fitList(view.notSensitive, view.notSensitiveCount);
  if (state !== "unlocked") showError(view.notSensitiveError, null);
}

/** The value just marked not sensitive, highlighted in its list for a moment. */
let kept: ValueChoice | null = null;

/** The review confirmation's timer. */
let reviewStatusTimer = 0;

/**
 * Say what a review button did, for a moment.
 *
 * @param text What happened.
 */
function confirmReview(text: string): void {
  view.reviewStatus.textContent = text;
  window.clearTimeout(reviewStatusTimer);
  reviewStatusTimer = window.setTimeout(() => {
    view.reviewStatus.textContent = "";
    kept = null;
    for (const row of view.notSensitive.querySelectorAll(".added"))
      row.classList.remove("added");
  }, ADDED_MS);
}

/**
 * Pseudonymize one reviewed value in the chat box.
 *
 * @param index The value's place in the review.
 */
async function markSensitive(index: number): Promise<void> {
  if (await act({ type: "review-mark-sensitive", index }, view.reviewError))
    confirmReview("Replaced in the chat box");
}

/**
 * Remember a reviewed value as not sensitive, and highlight it in its list.
 *
 * @param index The value's place in the review.
 * @param entityType Its type.
 * @param value The value.
 */
async function markNotSensitive(
  index: number,
  entityType: string,
  value: string,
): Promise<void> {
  kept = { entityType, value };
  if (await act({ type: "review-not-sensitive", index }, view.reviewError))
    confirmReview("Marked not sensitive");
  else kept = null;
}

/**
 * Pseudonymize every reviewed value in the chat box.
 *
 * @param count How many values the review had.
 */
async function replaceAll(count: number): Promise<void> {
  if (await act({ type: "review-approve" }, view.reviewError))
    confirmReview(
      `Replaced ${count} value${count === 1 ? "" : "s"} in the chat box`,
    );
}

/**
 * Replace a value remembered as not sensitive again.
 *
 * @param choice The value and its type.
 */
async function clearChoice(choice: ValueChoice): Promise<void> {
  await act({ type: "choice-clear", ...choice }, view.notSensitiveError);
}

/**
 * Keep a long list to a few values, scrolling within the panel for the rest.
 *
 * @param list The list.
 * @param note Where to say the list scrolls.
 */
function fitList(list: HTMLUListElement, note: HTMLParagraphElement): void {
  const count = list.childElementCount;
  const scroll = count > LIST_VISIBLE;
  list.classList.toggle("scroll", scroll);
  note.hidden = !scroll;
  note.textContent = scroll
    ? `${count} values. Scroll the list to see them all.`
    : "";
  if (!scroll) {
    list.style.maxHeight = "";
    return;
  }
  // Show the first few in full, and half the next, so the list looks scrollable
  const rows = Array.from(
    list.children,
    (row) => row.getBoundingClientRect().height,
  );
  const height =
    rows.slice(0, LIST_VISIBLE).reduce((sum, row) => sum + row, 0) +
    rows[LIST_VISIBLE] / 2;
  list.style.maxHeight = height > 0 ? `${height}px` : "";
}

/**
 * Pluralize a count of markers.
 *
 * @param count How many.
 * @returns "1 marker" or "N markers".
 */
function markers(count: number): string {
  return `${count} marker${count === 1 ? "" : "s"}`;
}

/**
 * Say what was restored in the page, or clear it.
 *
 * @param restored The restored answer, or null to clear it.
 */
function showRestored(restored: RestoredInPage | null): void {
  view.restored.hidden = restored === null;
  restoredText = restored?.text ?? "";
  if (!restored) return;
  const left = restored.unrestored
    ? ` ${markers(restored.unrestored)} couldn't be restored and stayed as is.`
    : "";
  let summary = `Showing ${restored.shown} original value${restored.shown === 1 ? "" : "s"} in the chat's answer.${left}`;
  if (restored.restored === 0)
    summary = `None of the ${markers(restored.unrestored)} in this answer could be restored.`;
  else if (restored.shown === 0)
    summary = `Restored ${markers(restored.restored)}, but couldn't show them in the page. Copy the restored answer instead.${left}`;
  view.restoredSummary.textContent = summary;
}

/** Put the markers back in this window's chat. */
async function hideInPage(): Promise<void> {
  const { id } = await chrome.windows.getCurrent();
  showRestored(null);
  await ask({
    type: "hide-originals",
    windowId: id ?? chrome.windows.WINDOW_ID_CURRENT,
  });
}

/**
 * Offer Restore while the vault is unlocked, clearing restored values when
 * it locks.
 *
 * @param state The vault's state.
 */
function renderRestore(state: VaultStatus["state"]): void {
  const unlocked = state === "unlocked";
  view.restoreLatest.disabled = !unlocked;
  view.restoreNote.textContent = unlocked
    ? ""
    : "Unlock your vault to restore markers in the chat's answers.";
  if (!unlocked) {
    showRestored(null);
    showError(view.restoreError, null);
  }
}

/** Restore the latest answer in this window's chat. */
async function restoreLatest(): Promise<void> {
  const { id } = await chrome.windows.getCurrent();
  const response = await ask<RestoredInPage>({
    type: "restore-latest",
    windowId: id ?? chrome.windows.WINDOW_ID_CURRENT,
  });
  if ("error" in response) {
    showRestored(null);
    showError(view.restoreError, response.error);
    return;
  }
  showError(view.restoreError, null);
  showRestored(response);
}

/** How long an added value stays highlighted, and its status shown, in ms. */
const ADDED_MS = 2000;

/** The value just added, or added again, to highlight while it's shown. */
let added: { name: ListName; value: string } | null = null;

/** What each list says when it's empty. */
const EMPTY_LIST: Record<ListName, string> = {
  allowlist: "No values yet.",
  denylist: "No phrases yet.",
};

/**
 * Find a list's elements: the list, its notes and its add form.
 *
 * @param name The list.
 * @returns The elements.
 */
function listParts(name: ListName) {
  return {
    list: document.querySelector<HTMLUListElement>(`#${name}`)!,
    note: document.querySelector<HTMLParagraphElement>(`#${name}-note`)!,
    count: document.querySelector<HTMLParagraphElement>(`#${name}-count`)!,
    form: document.querySelector<HTMLFormElement>(`#${name}-add`)!,
    field: document.querySelector<HTMLInputElement>(`#${name}-value`)!,
    status: document.querySelector<HTMLParagraphElement>(`#${name}-status`)!,
  };
}

/**
 * Show one of the user's lists, each value with Remove.
 *
 * @param name The list.
 * @param values Its values.
 */
function renderList(name: ListName, values: string[]): void {
  const { list, note, count } = listParts(name);
  note.textContent = values.length === 0 ? EMPTY_LIST[name] : "";
  // Values only ever go in as text, never as markup
  list.replaceChildren(
    ...values.map((value) => {
      const item = document.createElement("li");
      const text = document.createElement("div");
      text.textContent = value;
      const remove = linkButton("Remove");
      remove.addEventListener("click", () => void removeFromList(name, value));
      item.append(text, remove);
      return item;
    }),
  );
  fitList(list, count);
  const index = added?.name === name ? values.indexOf(added.value) : -1;
  const row = list.children[index];
  if (!row) return;
  row.classList.add("added");
  row.scrollIntoView({ block: "nearest" });
}

/**
 * Say what adding to a list did, and highlight the value in the list, for a
 * moment.
 *
 * @param name The list.
 * @param value The value, as typed.
 * @param result What adding it did.
 */
async function confirmAdd(
  name: ListName,
  value: string,
  result: ListAdd,
): Promise<void> {
  if (result === "blank") return;
  const { status } = listParts(name);
  const highlight = { name, value: value.trim() };
  added = highlight;
  status.textContent = result === "added" ? "Added" : "Already in the list";
  status.classList.toggle("ok", result === "added");
  // A new value redraws the list when the settings change; one already
  // listed is highlighted where it is
  await refreshLists();
  window.setTimeout(() => {
    if (added !== highlight) return;
    added = null;
    status.textContent = "";
    for (const row of listParts(name).list.querySelectorAll(".added"))
      row.classList.remove("added");
  }, ADDED_MS);
}

/**
 * Show both lists from the settings.
 *
 * @param settings The current settings.
 */
function renderLists(settings: Settings): void {
  renderList("allowlist", settings.allowlist);
  renderList("denylist", settings.denylist);
}

/** Read the settings and show their lists. */
async function refreshLists(): Promise<void> {
  renderLists(await loadSettings());
}

/**
 * Show the vault and any review.
 *
 * @param status The vault's status.
 */
function render(status: VaultStatus): void {
  renderVault(status);
  renderReview(status);
  renderNotSensitive(status);
  renderRestore(status.state);
}

/** Offer Update now while a downloaded update waits to install. */
async function checkUpdate(): Promise<void> {
  const response = await ask<{ ready?: boolean }>({ type: "update-status" });
  view.update.hidden = "error" in response || response.ready !== true;
}

/**
 * Fetch the status and show it.
 *
 * @param autoUnlock Whether a remembered device may unlock the vault.
 */
async function refresh(autoUnlock = false): Promise<void> {
  const status = await ask<VaultStatus>({ type: "vault-status", autoUnlock });
  if ("error" in status) showError(view.vaultError, status.error);
  else render(status);
}

/**
 * Run a request from a form or button, showing its result.
 *
 * @param request The request.
 * @param errorTarget Where to show a failure.
 * @returns Whether it succeeded.
 */
async function act(
  request: PanelRequest,
  errorTarget: HTMLElement,
): Promise<boolean> {
  const response = await ask<VaultStatus>(request);
  if ("error" in response) {
    // The review may have changed even though the request failed
    await refresh();
    showError(errorTarget, response.error);
    return false;
  }
  showError(errorTarget, null);
  render(response);
  return true;
}

/**
 * Create the vault, leaving it unlocked.
 *
 * @param password The new password.
 */
async function create(password: string, remember: boolean): Promise<void> {
  const response = await ask<VaultStatus>({
    type: "vault-create",
    password,
    remember,
  });
  if ("error" in response) {
    showError(view.vaultError, response.error);
    return;
  }
  showError(view.vaultError, null);
  render(response);
}

/**
 * Unlock the vault.
 *
 * @param password The password.
 * @param remember Whether to remember this device for 30 days.
 */
async function unlock(password: string, remember: boolean): Promise<void> {
  const response = await ask<VaultStatus>({
    type: "vault-unlock",
    password,
    remember,
  });
  if ("error" in response) {
    await refresh();
    showError(view.vaultError, response.error);
    return;
  }
  showError(view.vaultError, null);
  render(response);
}

view.create.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!checkPassword()) return;
  const password = view.createPassword.value;
  const remember = view.createRemember.checked;
  view.create.reset();
  checkPassword();
  void create(password, remember);
});
view.create.addEventListener("input", () => void checkPassword());

view.unlock.addEventListener("submit", (event) => {
  event.preventDefault();
  const password = view.unlockPassword.value;
  if (password === "") return;
  const remember = view.unlockRemember.checked;
  view.unlock.reset();
  void unlock(password, remember);
});

view.remembered
  .querySelector("#forget-device")!
  .addEventListener(
    "click",
    () => void act({ type: "device-forget" }, view.vaultError),
  );

document
  .querySelector("#lock")!
  .addEventListener(
    "click",
    () => void act({ type: "vault-lock" }, view.vaultError),
  );
document
  .querySelector("#approve")!
  .addEventListener(
    "click",
    () => void replaceAll(view.reviewItems.childElementCount),
  );
document
  .querySelector("#cancel")!
  .addEventListener(
    "click",
    () => void act({ type: "review-cancel" }, view.reviewError),
  );
view.deleteOpen.addEventListener("click", () => showDelete(true));
document
  .querySelector("#delete-cancel")!
  .addEventListener("click", () => showDelete(false));
view.deleteForm.addEventListener("input", () => {
  view.deleteSubmit.disabled = !deleteConfirmed();
});
view.deleteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!deleteConfirmed()) return;
  view.deleteForm.reset();
  view.deleteSubmit.disabled = true;
  void ask<VaultStatus>({ type: "vault-delete" }).then(async (response) => {
    if ("error" in response) {
      // Deleting locks the vault first
      await refresh();
      showError(view.vaultError, response.error);
      return;
    }
    deleting = false;
    showError(view.vaultError, null);
    render(response);
  });
});
/**
 * Make an info button show its box while hovered or focused, and keep it open
 * once clicked, until clicked again or Escape is pressed.
 *
 * @param toggle The info button.
 */
function setUpInfo(toggle: HTMLButtonElement): void {
  const info = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  let pinned = false;
  let hovered = false;
  const update = () => {
    // Keyboard focus opens it; a mouse click's focus leaves it to the pin
    const open = pinned || hovered || toggle.matches(":focus-visible");
    info.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  // The box counts as hovered too, so its link can be reached
  for (const target of [toggle, info]) {
    target.addEventListener("mouseenter", () => {
      hovered = true;
      update();
    });
    target.addEventListener("mouseleave", () => {
      hovered = false;
      update();
    });
  }
  toggle.addEventListener("focus", update);
  toggle.addEventListener("blur", update);
  toggle.addEventListener("click", () => {
    pinned = !pinned;
    update();
  });
  toggle.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    pinned = false;
    toggle.blur();
    update();
  });
}

for (const toggle of document.querySelectorAll<HTMLButtonElement>(
  "button.icon[aria-controls]",
)) {
  setUpInfo(toggle);
}
view.restoreLatest.addEventListener("click", () => void restoreLatest());
document.querySelector("#copy-restored")!.addEventListener("click", () => {
  void navigator.clipboard.writeText(restoredText);
});
document
  .querySelector("#hide-originals")!
  .addEventListener("click", () => void hideInPage());
document
  .querySelector("#settings")!
  .addEventListener("click", () => chrome.runtime.openOptionsPage());
// Reloading installs the waiting update, and closes this panel
document
  .querySelector("#update-now")!
  .addEventListener("click", () => chrome.runtime.reload());

// Adding to a list saves the settings, then says so and highlights the value
for (const name of ["allowlist", "denylist"] as const) {
  const { form, field } = listParts(name);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const { value } = field;
    void addToList(name, value).then(async (result) => {
      field.value = "";
      await confirmAdd(name, value, result);
    });
  });
}

// The lists also change from the settings page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "settings" in changes) void refreshLists();
});

// The vault tells the panel when it locks or a review arrives
chrome.runtime.onMessage.addListener((message: PanelNotice | object) => {
  if (!("target" in message) || message.target !== "panel") return false;
  if (message.type === "update-ready") void checkUpdate();
  else void refresh();
  return false;
});

/** Connect to the service worker, which closes this panel on request. */
export async function connect(): Promise<void> {
  const { id } = await chrome.windows.getCurrent();
  const port = chrome.runtime.connect({ name: String(id) });
  port.onMessage.addListener(() => window.close());
  // Chrome stops an idle service worker; reconnecting restarts it
  port.onDisconnect.addListener(() => void connect());
}

void connect();
void refresh(true);
void checkUpdate();
void refreshLists();
