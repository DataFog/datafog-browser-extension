/**
 * Side panel: the vault, the Pseudonymize review, and later the workspace and
 * restore views.
 */

import type {
  ErrorResponse,
  PanelNotice,
  PanelRequest,
  VaultStatus,
} from "./messages";

/** Shortest password the vault accepts. */
const MIN_PASSWORD = 8;

/** What each error code means, for codes a user can act on. */
const EXPLAINED: Record<string, string> = {
  chat_box_changed:
    "The chat box changed after this review was prepared. Choose Pseudonymize again.",
  nothing_found: "There's nothing to pseudonymize in the chat box.",
  no_review: "This review is gone. Choose Pseudonymize again.",
  passwords_differ: "The passwords don't match.",
  password_short: `Use a password of at least ${MIN_PASSWORD} characters.`,
};

const view = {
  review: document.querySelector<HTMLElement>("#review")!,
  reviewNote: document.querySelector<HTMLParagraphElement>("#review-note")!,
  reviewItems: document.querySelector<HTMLUListElement>("#review-items")!,
  reviewButtons: document.querySelector<HTMLDivElement>("#review-buttons")!,
  reviewError: document.querySelector<HTMLParagraphElement>("#review-error")!,
  approve: document.querySelector<HTMLButtonElement>("#approve")!,
  vaultNote: document.querySelector<HTMLParagraphElement>("#vault-note")!,
  create: document.querySelector<HTMLFormElement>("#create")!,
  createPassword: document.querySelector<HTMLInputElement>("#create-password")!,
  createConfirm: document.querySelector<HTMLInputElement>("#create-confirm")!,
  recovery: document.querySelector<HTMLDivElement>("#recovery")!,
  recoveryKey: document.querySelector<HTMLElement>("#recovery-key")!,
  unlock: document.querySelector<HTMLFormElement>("#unlock")!,
  unlockPassword: document.querySelector<HTMLInputElement>("#unlock-password")!,
  unlocked: document.querySelector<HTMLDivElement>("#unlocked")!,
  vaultError: document.querySelector<HTMLParagraphElement>("#vault-error")!,
};

/** Kept only until the user says they saved it. */
let recoveryKey: string | null = null;

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
function renderVault(state: VaultStatus["state"]): void {
  view.create.hidden = state !== "none" || recoveryKey !== null;
  view.recovery.hidden = recoveryKey === null;
  view.recoveryKey.textContent = recoveryKey ?? "";
  view.unlock.hidden = state !== "locked";
  view.unlocked.hidden = state !== "unlocked" || recoveryKey !== null;
  if (state === "none")
    view.vaultNote.textContent =
      "Create a vault to pseudonymize: DataFog swaps each value for a marker such as [[EMAIL_7KQ4ZM]] and keeps the original, encrypted, on this device.";
  else if (state === "locked")
    view.vaultNote.textContent = "Locked. Enter your password to unlock.";
  else
    view.vaultNote.textContent =
      "Unlocked. It locks after 15 minutes without use, or when Chrome closes.";
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
    ...(review ?? []).map(({ original, marker }) => {
      const item = document.createElement("li");
      const value = document.createElement("div");
      value.textContent = original;
      const replacement = document.createElement("div");
      replacement.className = "marker";
      replacement.textContent = `→ ${marker}`;
      item.append(value, replacement);
      return item;
    }),
  );
  showError(view.reviewError, reviewError);
}

/**
 * Show the vault and any review.
 *
 * @param status The vault's status.
 */
function render(status: VaultStatus): void {
  renderVault(status.state);
  renderReview(status);
}

/** Fetch the status and show it. */
async function refresh(): Promise<void> {
  const status = await ask<VaultStatus>({ type: "vault-status" });
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
async function create(password: string): Promise<void> {
  const response = await ask<{ status: VaultStatus; recoveryKey: string }>({
    type: "vault-create",
    password,
  });
  if ("error" in response) {
    showError(view.vaultError, response.error);
    return;
  }
  showError(view.vaultError, null);
  recoveryKey = response.recoveryKey;
  render(response.status);
}

view.create.addEventListener("submit", (event) => {
  event.preventDefault();
  const password = view.createPassword.value;
  if (password.length < MIN_PASSWORD) {
    showError(view.vaultError, "password_short");
    return;
  }
  if (password !== view.createConfirm.value) {
    showError(view.vaultError, "passwords_differ");
    return;
  }
  view.create.reset();
  void create(password);
});

view.unlock.addEventListener("submit", (event) => {
  event.preventDefault();
  const password = view.unlockPassword.value;
  view.unlock.reset();
  void act({ type: "vault-unlock", password }, view.vaultError);
});

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
void refresh();
