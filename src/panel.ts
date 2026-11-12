/**
 * Side panel: the vault, the Pseudonymize review, the workspace's not
 * sensitive values, and restoring answers.
 */

import type {
  ErrorResponse,
  PanelNotice,
  PanelRequest,
  RestoredInPage,
  UnlockedVault,
  ValueChoice,
  VaultStatus,
} from "./messages";
import { LABELS } from "./settings";

/** What the recovery key is for, when the vault is new. */
const RECOVERY_NOTE =
  "Your recovery key. Save it somewhere safe, such as a password manager. You'll need it to get back into your vault if you forget your password, and DataFog can't show it again.";

/** Why there's a new recovery key, when remembering changed the vault's keys. */
const NEW_RECOVERY_NOTE =
  "Remembering this device gave your vault new keys, so your old recovery key no longer works. Save this new one somewhere safe, such as a password manager. DataFog can't show it again.";

/** Values the review shows before its list scrolls. */
const REVIEW_VISIBLE = 5;

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
  no_chat: "Open a ChatGPT chat in this tab to restore its latest answer.",
  no_answer: "There's no answer in this chat yet.",
  vault_locked: "Unlock your vault to restore.",
  no_markers: "There are no markers in ChatGPT's latest answer.",
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
  review: document.querySelector<HTMLElement>("#review")!,
  reviewNote: document.querySelector<HTMLParagraphElement>("#review-note")!,
  reviewCount: document.querySelector<HTMLParagraphElement>("#review-count")!,
  reviewItems: document.querySelector<HTMLUListElement>("#review-items")!,
  reviewButtons: document.querySelector<HTMLDivElement>("#review-buttons")!,
  reviewError: document.querySelector<HTMLParagraphElement>("#review-error")!,
  approve: document.querySelector<HTMLButtonElement>("#approve")!,
  vaultState: document.querySelector<HTMLSpanElement>("#vault-state")!,
  create: document.querySelector<HTMLFormElement>("#create")!,
  createPassword: document.querySelector<HTMLInputElement>("#create-password")!,
  createConfirm: document.querySelector<HTMLInputElement>("#create-confirm")!,
  createSubmit: document.querySelector<HTMLButtonElement>("#create-submit")!,
  createRemember: document.querySelector<HTMLInputElement>("#create-remember")!,
  unlockRemember: document.querySelector<HTMLInputElement>("#unlock-remember")!,
  recoveryNote: document.querySelector<HTMLParagraphElement>("#recovery-note")!,
  remembered: document.querySelector<HTMLParagraphElement>("#remembered")!,
  rememberedUntil:
    document.querySelector<HTMLSpanElement>("#remembered-until")!,
  resetOpen: document.querySelector<HTMLButtonElement>("#reset-open")!,
  reset: document.querySelector<HTMLFormElement>("#reset")!,
  resetPassword: document.querySelector<HTMLInputElement>("#reset-password")!,
  ruleLength: document.querySelector<HTMLLIElement>("#rule-length")!,
  ruleMatch: document.querySelector<HTMLLIElement>("#rule-match")!,
  recovery: document.querySelector<HTMLDivElement>("#recovery")!,
  recoveryKey: document.querySelector<HTMLElement>("#recovery-key")!,
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
  workspaceNote:
    document.querySelector<HTMLParagraphElement>("#workspace-note")!,
  notSensitive: document.querySelector<HTMLUListElement>("#not-sensitive")!,
  workspaceError:
    document.querySelector<HTMLParagraphElement>("#workspace-error")!,
};

/** Kept only until the user says they saved it. */
let recoveryKey: string | null = null;

/** The latest restored answer, kept only for Copy until it's hidden. */
let restoredText = "";

/** Whether the reset form is open. */
let resetting = false;

/** The last status shown, to redraw after opening or closing the reset form. */
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
 * Show the vault: create, recovery key, unlock or lock.
 *
 * @param state The vault's state.
 */
function renderVault(status: VaultStatus): void {
  const { state, rememberedUntil } = status;
  view.remembered.hidden =
    state === "none" || rememberedUntil === null || recoveryKey !== null;
  view.rememberedUntil.textContent = rememberedUntil
    ? `This device is remembered until ${new Date(rememberedUntil).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`
    : "";
  view.create.hidden = state !== "none" || recoveryKey !== null;
  view.recovery.hidden = recoveryKey === null;
  view.recoveryKey.textContent = recoveryKey ?? "";
  if (recoveryKey === null) view.recoveryNote.textContent = RECOVERY_NOTE;
  view.unlock.hidden = state !== "locked" || resetting;
  view.unlocked.hidden =
    state !== "unlocked" || recoveryKey !== null || resetting;
  view.resetOpen.hidden = state === "none" || recoveryKey !== null || resetting;
  view.reset.hidden = state === "none" || !resetting;
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
 * Open or close the reset form.
 *
 * @param open Whether to open it.
 */
function showReset(open: boolean): void {
  resetting = open;
  view.reset.reset();
  showError(view.vaultError, null);
  if (shown) renderVault(shown);
  if (open) view.resetPassword.focus();
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
  const password = view.createPassword.value;
  const confirm = view.createConfirm.value;
  const long = password.length >= MIN_PASSWORD;
  const match = password === confirm;
  markRule(view.ruleLength, long, password !== "");
  markRule(view.ruleMatch, match, confirm !== "");
  view.createSubmit.disabled = !(long && match);
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
      "Each value will be replaced with its marker, and saved in your vault so it can be restored later.";
  else if (waiting)
    view.reviewNote.textContent = `${state === "none" ? "Create" : "Unlock"} your vault below to review the values to pseudonymize.`;
  else view.reviewNote.textContent = "";
  // Values only ever go in as text, never as markup
  view.reviewItems.replaceChildren(
    ...(review ?? []).map(({ original, marker }, index) => {
      const item = document.createElement("li");
      const value = document.createElement("div");
      value.textContent = original;
      const replacement = document.createElement("div");
      replacement.className = "marker";
      replacement.textContent = `→ ${marker}`;
      const keep = linkButton("Not sensitive");
      keep.addEventListener(
        "click",
        () =>
          void act({ type: "review-not-sensitive", index }, view.reviewError),
      );
      item.append(value, replacement, keep);
      return item;
    }),
  );
  fitReview(review?.length ?? 0);
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
function renderWorkspace({ state, notSensitive }: VaultStatus): void {
  if (state !== "unlocked")
    view.workspaceNote.textContent =
      "Unlock your vault to see the values you've marked not sensitive.";
  else
    view.workspaceNote.textContent =
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
      return item;
    }),
  );
  if (state !== "unlocked") showError(view.workspaceError, null);
}

/**
 * Replace a value remembered as not sensitive again.
 *
 * @param choice The value and its type.
 */
async function clearChoice(choice: ValueChoice): Promise<void> {
  await act({ type: "choice-clear", ...choice }, view.workspaceError);
}

/**
 * Keep a long review to a few values, scrolling within the panel for the
 * rest.
 *
 * @param count How many values the review has.
 */
function fitReview(count: number): void {
  const scroll = count > REVIEW_VISIBLE;
  view.reviewItems.classList.toggle("scroll", scroll);
  view.reviewCount.hidden = !scroll;
  view.reviewCount.textContent = scroll
    ? `${count} values. Scroll the list to see them all.`
    : "";
  if (!scroll) {
    view.reviewItems.style.maxHeight = "";
    return;
  }
  // Show the first few in full, and half the next, so the list looks scrollable
  const rows = Array.from(
    view.reviewItems.children,
    (row) => row.getBoundingClientRect().height,
  );
  const height =
    rows.slice(0, REVIEW_VISIBLE).reduce((sum, row) => sum + row, 0) +
    rows[REVIEW_VISIBLE] / 2;
  view.reviewItems.style.maxHeight = height > 0 ? `${height}px` : "";
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
  let summary = `Showing ${restored.shown} original value${restored.shown === 1 ? "" : "s"} in ChatGPT's answer.${left}`;
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
    ? "Show the original values in place of markers in ChatGPT's latest answer."
    : "Unlock your vault to restore markers in ChatGPT's answers.";
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

/**
 * Show the vault and any review.
 *
 * @param status The vault's status.
 */
function render(status: VaultStatus): void {
  renderVault(status);
  renderReview(status);
  renderWorkspace(status);
  renderRestore(status.state);
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
 */
async function act(
  request: PanelRequest,
  errorTarget: HTMLElement,
): Promise<void> {
  const response = await ask<VaultStatus>(request);
  if ("error" in response) {
    // The review may have changed even though the request failed
    await refresh();
    showError(errorTarget, response.error);
    return;
  }
  showError(errorTarget, null);
  render(response);
}

/**
 * Create the vault, then show its recovery key once.
 *
 * @param password The new password.
 */
async function create(password: string, remember: boolean): Promise<void> {
  const response = await ask<{ status: VaultStatus; recoveryKey: string }>({
    type: "vault-create",
    password,
    remember,
  });
  if ("error" in response) {
    showError(view.vaultError, response.error);
    return;
  }
  showError(view.vaultError, null);
  recoveryKey = response.recoveryKey;
  render(response.status);
}

/**
 * Unlock the vault, showing a new recovery key if remembering made one.
 *
 * @param password The password.
 * @param remember Whether to remember this device for 30 days.
 */
async function unlock(password: string, remember: boolean): Promise<void> {
  const response = await ask<UnlockedVault>({
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
  if (response.recoveryKey) {
    recoveryKey = response.recoveryKey;
    view.recoveryNote.textContent = NEW_RECOVERY_NOTE;
  }
  render(response.status);
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
    () => void act({ type: "review-approve" }, view.reviewError),
  );
document
  .querySelector("#cancel")!
  .addEventListener(
    "click",
    () => void act({ type: "review-cancel" }, view.reviewError),
  );
view.resetOpen.addEventListener("click", () => showReset(true));
document
  .querySelector("#reset-cancel")!
  .addEventListener("click", () => showReset(false));
view.reset.addEventListener("submit", (event) => {
  event.preventDefault();
  const password = view.resetPassword.value;
  if (password === "") return;
  view.reset.reset();
  void ask<VaultStatus>({ type: "vault-reset", password }).then(
    async (response) => {
      if ("error" in response) {
        // A reset locks the vault before checking the password
        await refresh();
        showError(view.vaultError, response.error);
        return;
      }
      resetting = false;
      showError(view.vaultError, null);
      render(response);
    },
  );
});
// Each info button shows or hides the box it controls
for (const toggle of document.querySelectorAll<HTMLButtonElement>(
  "button.icon[aria-controls]",
)) {
  const info = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  toggle.addEventListener("click", () => {
    info.hidden = !info.hidden;
    toggle.setAttribute("aria-expanded", String(!info.hidden));
  });
}
view.restoreLatest.addEventListener("click", () => void restoreLatest());
document.querySelector("#copy-restored")!.addEventListener("click", () => {
  void navigator.clipboard.writeText(restoredText);
});
document
  .querySelector("#hide-originals")!
  .addEventListener("click", () => void hideInPage());
document.querySelector("#copy-key")!.addEventListener("click", () => {
  if (recoveryKey) void navigator.clipboard.writeText(recoveryKey);
});
document.querySelector("#saved-key")!.addEventListener("click", () => {
  recoveryKey = null;
  void refresh();
});
document
  .querySelector("#settings")!
  .addEventListener("click", () => chrome.runtime.openOptionsPage());

// The vault tells the panel when it locks or a review arrives
chrome.runtime.onMessage.addListener((message: PanelNotice | object) => {
  if ("target" in message && message.target === "panel") void refresh();
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
