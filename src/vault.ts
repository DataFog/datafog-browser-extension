/**
 * The vault and Pseudonymize, in the offscreen document.
 *
 * FogVault keeps the workspace encrypted on this device; Core's adapter owns
 * the workspace, which maps each value to its marker. Nothing here leaves the
 * extension: the password and the original values reach only the side panel
 * and this document.
 *
 * A remembered device unlocks the vault without the password for 30 days, on
 * use. A manual lock pauses that until the next password unlock.
 */

import type {
  FogVaultWorkspace,
  WorkspaceVaultPlan,
} from "@datafog/core-fogvault-browser";
import type {
  FogVault,
  KeyProvider,
  ProviderIdentity,
} from "@datafog/fogvault-browser";
import type { WorkspaceFinding } from "@datafog/wasm";

import type {
  CreatedVault,
  UnlockedVault,
  Pseudonymized,
  RestoredValue,
  RestoredWithValues,
  RedactEdit,
  ReviewItem,
  ReviewSource,
  VaultRouting,
  VaultStatus,
} from "./messages";
import { sameChecks, type Settings } from "./settings";
import type { Devices } from "./device";

/** The vault's name in IndexedDB. */
export const VAULT_NAME = "datafog";

/** Lock after this long without use, as the ADR sets. */
export const IDLE_LOCK_MS = 15 * 60_000;

/** The parts of FogVault the host uses. */
export type Vault = Pick<
  FogVault,
  | "create"
  | "open"
  | "unlock"
  | "lock"
  | "close"
  | "reconcileLatest"
  | "describeAccess"
  | "unlockDevice"
  | "enrollDevice"
  | "protectAccess"
>;

/** The parts of Core's adapter the host uses. */
export type Owner = Pick<
  FogVaultWorkspace,
  "prepareReview" | "commit" | "lock" | "closed" | "restoreReport"
>;

/** Raw identifiers for opening the workspace. */
export interface Route {
  recordId: Uint8Array;
  namespace: Uint8Array;
}

/** What the host needs from FogVault, Core and the offscreen document. */
export interface VaultDeps<V extends Vault> {
  /** A FogVault that knows every device identity the vault may hold. */
  newVault: (providers: KeyProvider[]) => V;
  devices: Devices;
  now: () => number;
  createOwner: (vault: V, route: Route) => Promise<Owner>;
  openOwner: (vault: V, route: Route) => Promise<Owner>;
  findings: (text: string, settings: Settings) => Promise<WorkspaceFinding[]>;
  randomId: () => Uint8Array;
  /** Delete the vault's database. */
  deleteStore: (name: string) => Promise<void>;
  /** Tell an open side panel to show the new status. */
  notify: () => void;
}

/** A prepared review, waiting for approval in the side panel. */
interface Review extends ReviewSource {
  plan: WorkspaceVaultPlan;
  items: ReviewItem[];
  /** The settings it was found under. */
  settings: Settings;
}

/** Pseudonymize asked for while the vault was locked. */
interface Waiting extends ReviewSource {
  settings: Settings;
}

/**
 * An error carrying only a code, as every response does.
 *
 * @param code The code.
 * @returns The error.
 */
function failure(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/**
 * The code of a thrown error.
 *
 * @param error What was thrown.
 * @returns Its code, or a generic one.
 */
function codeOf(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  return typeof code === "string" ? code : "datafog_failed";
}

/**
 * Take a recovery key FogVault handed over, wiping its bytes.
 *
 * @param key The key's bytes, if any.
 * @returns Its base64 text, or an empty string.
 */
function takeKey(key: Uint8Array | null | undefined): string {
  const text = key ? toBase64(key) : "";
  key?.fill(0);
  return text;
}

/**
 * Encode bytes as base64.
 *
 * @param bytes The bytes.
 * @returns Their base64 text.
 */
export function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Decode base64 text.
 *
 * @param text The base64 text.
 * @returns Its bytes.
 */
function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/**
 * Read stored routing back into identifiers.
 *
 * @param routing The stored routing.
 * @returns The identifiers.
 */
function toRoute(routing: VaultRouting): Route {
  return {
    recordId: fromBase64(routing.recordId),
    namespace: fromBase64(routing.namespace),
  };
}

export class VaultHost<V extends Vault = Vault> {
  private vault: V | null = null;
  private opened = false;
  private owner: Owner | null = null;
  private review: Review | null = null;
  private waiting: Waiting | null = null;
  /** Counts review preparations, so a cancelled or replaced one is dropped. */
  private turn = 0;
  private error: string | null = null;
  /** A save whose outcome is unknown, to reconcile at the next unlock. */
  private unsettled: Uint8Array | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;

  /**
   * Set up the host; nothing opens until it's asked to.
   *
   * @param deps FogVault, Core and the offscreen document.
   */
  constructor(private readonly deps: VaultDeps<V>) {}

  /**
   * Describe the vault and any review, for the side panel.
   *
   * @param routing Where the workspace lives, or null if there's no vault.
   * @returns The status.
   */
  status(routing: VaultRouting | null): VaultStatus {
    let state: VaultStatus["state"] = "locked";
    if (!routing) state = "none";
    else if (this.owner && !this.owner.closed) state = "unlocked";
    return {
      state,
      waiting: this.waiting !== null,
      review: this.review?.items ?? null,
      reviewError: this.error,
      rememberedUntil: routing
        ? this.deps.devices.rememberedUntil(this.deps.now())
        : null,
    };
  }

  /**
   * The vault, made with every device identity FogVault must know.
   *
   * @returns The vault.
   */
  private ensureVault(): V {
    this.vault ??= this.deps.newVault(this.deps.devices.providers());
    return this.vault;
  }

  /** Close the vault, so the next one knows newly made device identities. */
  private async dropVault(): Promise<void> {
    await this.vault?.close();
    this.vault = null;
    this.opened = false;
  }

  /**
   * Open the vault's database, once.
   *
   * @returns The vault.
   */
  private async openVault(): Promise<V> {
    const vault = this.ensureVault();
    if (!this.opened) {
      await vault.open(VAULT_NAME);
      this.opened = true;
    }
    return vault;
  }

  /**
   * Reopen the workspace once the vault is unlocked.
   *
   * @param vault The unlocked vault.
   * @param routing Where the workspace lives.
   */
  private async openWorkspace(vault: V, routing: VaultRouting): Promise<void> {
    if (this.unsettled) {
      // Settle the save that lost its answer before trusting the saved state
      await vault.reconcileLatest(this.unsettled);
      this.unsettled = null;
    }
    this.owner = await this.deps.openOwner(vault, toRoute(routing));
    this.error = null;
    this.touch();
    await this.prepareWaiting();
  }

  /**
   * Unlock with the remembered device, if there is one and the vault is
   * locked. Fails quietly: the password still works.
   *
   * @param routing Where the workspace lives.
   */
  async unlockWithDevice(routing: VaultRouting | null): Promise<void> {
    if (!routing || (this.owner && !this.owner.closed)) return;
    const { devices } = this.deps;
    await devices.prune(this.deps.now());
    const device = devices.active(this.deps.now());
    if (!device) return;
    try {
      const vault = await this.openVault();
      const access = await vault.describeAccess();
      const slot = access.devices.find(
        ({ identity }) => toBase64(identity.keyId) === device.keyId,
      )?.slotId;
      if (!slot) return;
      await vault.unlockDevice(slot);
      await this.openWorkspace(vault, routing);
      this.deps.notify();
    } catch {
      // A key that no longer unwraps is no use; forget it
      await devices.forget();
    }
  }

  /**
   * Make a device key, closing the vault so the next one knows it.
   *
   * @returns The key's identity.
   */
  private async newDevice(): Promise<ProviderIdentity> {
    await this.deps.devices.forget();
    const identity = await this.deps.devices.create(this.deps.now());
    await this.dropVault();
    return identity;
  }

  /**
   * Create the vault and its workspace, leaving it unlocked.
   *
   * Every vault starts with a device slot, so remembering a device later keeps
   * its keys and recovery key; without Remember, that key is deleted at once.
   *
   * @param password The new password.
   * @param routing Existing routing, if a vault was already created.
   * @param remember Whether to remember this device for 30 days.
   * @returns The status, the one-time recovery key and the new routing.
   */
  async create(
    password: string,
    routing: VaultRouting | null,
    remember: boolean,
  ): Promise<CreatedVault> {
    if (routing) throw failure("vault_exists");
    const identity = await this.newDevice();
    const vault = this.ensureVault();
    const created = await vault.create(VAULT_NAME, password, {
      recovery: true,
      profile: "password-or-device",
      devices: [identity],
    });
    this.opened = true;
    if (!remember) await this.deps.devices.forget();
    await this.deps.devices.setPaused(false);
    const route = {
      recordId: this.deps.randomId(),
      namespace: this.deps.randomId(),
    };
    this.owner = await this.deps.createOwner(vault, route);
    const recoveryKey = takeKey(created.recovery_key);
    const made = {
      recordId: toBase64(route.recordId),
      namespace: toBase64(route.namespace),
    };
    this.touch();
    await this.prepareWaiting();
    return { status: this.status(made), recoveryKey, routing: made };
  }

  /**
   * Unlock the vault with the password and reopen its workspace, remembering
   * this device if asked.
   *
   * A vault made before remember device has no device slot. Adding one
   * re-encrypts it with new keys, so it comes with a new recovery key.
   *
   * @param password The password.
   * @param routing Where the workspace lives.
   * @param remember Whether to remember this device for 30 days.
   * @returns The status, and a new recovery key if the vault needed one.
   */
  async unlock(
    password: string,
    routing: VaultRouting | null,
    remember: boolean,
  ): Promise<UnlockedVault> {
    if (!routing) throw failure("no_vault");
    if (this.owner && !this.owner.closed)
      return { status: this.status(routing), recoveryKey: null };
    const identity = remember ? await this.newDevice() : null;
    const vault = await this.openVault();
    await vault.unlock(password);
    await this.deps.devices.setPaused(false);
    let recoveryKey: string | null = null;
    if (identity) {
      const source = { kind: "password" as const, password };
      const { profile } = await vault.describeAccess();
      if (profile === "password-or-device")
        await vault.enrollDevice(source, identity);
      else
        recoveryKey = takeKey(
          (
            await vault.protectAccess(source, {
              password,
              profile: "password-or-device",
              devices: [identity],
              recovery: true,
            })
          ).recovery_key,
        );
    }
    await this.openWorkspace(vault, routing);
    return { status: this.status(routing), recoveryKey };
  }

  /**
   * Forget this device, so the vault needs the password again.
   *
   * @param routing Where the workspace lives.
   * @returns The status.
   */
  async forgetDevice(routing: VaultRouting | null): Promise<VaultStatus> {
    await this.deps.devices.forget();
    return this.status(routing);
  }

  /**
   * Lock the vault, dropping any review. Locking by hand also pauses the
   * remembered device until the next password unlock.
   *
   * @param routing Where the workspace lives.
   * @param manual Whether the user chose to lock.
   * @returns The status.
   */
  async lock(
    routing: VaultRouting | null,
    manual = false,
  ): Promise<VaultStatus> {
    clearTimeout(this.idle);
    if (manual && this.deps.devices.rememberedUntil(this.deps.now()))
      await this.deps.devices.setPaused(true);
    this.drop();
    this.waiting = null;
    const owner = this.owner;
    this.owner = null;
    // The adapter locks the vault under it, revoking Core first
    if (owner && !owner.closed) await owner.lock();
    else await this.vault?.lock();
    return this.status(routing);
  }

  /**
   * Delete the vault and everything in it, once the password checks out.
   * The vault is locked first, so a wrong password leaves it locked.
   *
   * @param password The password.
   * @param routing Where the workspace lives.
   * @returns The status, with no vault.
   */
  async reset(
    password: string,
    routing: VaultRouting | null,
  ): Promise<VaultStatus> {
    if (!routing) throw failure("no_vault");
    await this.lock(routing);
    const vault = await this.openVault();
    await vault.unlock(password);
    // Closing stops FogVault's Worker, releasing the database to delete
    await vault.close();
    this.vault = null;
    this.opened = false;
    this.unsettled = null;
    this.error = null;
    await this.deps.deleteStore(VAULT_NAME);
    await this.deps.devices.clear();
    this.deps.notify();
    return this.status(null);
  }

  /**
   * Put the original values back in place of the vault's markers. Markers the
   * vault can't restore, such as ones it never issued, are left as they are.
   *
   * @param text Text with markers, such as an answer.
   * @returns The restored text, how many markers were and weren't, and each
   *   restored marker's value.
   */
  restore(text: string): RestoredWithValues {
    const owner = this.owner;
    if (!owner || owner.closed) throw failure("vault_locked");
    this.touch();
    const values: RestoredValue[] = [];
    for (const marker of new Set(text.match(/\[\[[A-Z0-9_]+\]\]/g))) {
      const original = owner.restoreReport(marker).text;
      if (original !== null && original !== marker)
        values.push({ marker, original });
    }
    const report = owner.restoreReport(text);
    if (report.text !== null)
      return {
        text: report.text,
        restored: report.restoredMarkers,
        unrestored: 0,
        values,
      };
    // Core restores all or nothing, so restore the text between the problems
    let restored = 0;
    let at = 0;
    const parts: string[] = [];
    const issues = report.issues.toSorted(
      (a, b) => a.utf16Range.start - b.utf16Range.start,
    );
    for (const { utf16Range } of [
      ...issues,
      { utf16Range: { start: text.length, end: text.length } },
    ]) {
      const span = text.slice(at, utf16Range.start);
      const part = owner.restoreReport(span);
      parts.push(
        part.text ?? span,
        text.slice(utf16Range.start, utf16Range.end),
      );
      restored += part.text === null ? 0 : part.restoredMarkers;
      at = utf16Range.end;
    }
    return {
      text: parts.join(""),
      restored,
      unrestored: issues.length,
      values,
    };
  }

  /**
   * Prepare a review of the chat box's values, or wait for an unlock.
   *
   * @param text The chat box's text.
   * @param tabId Its tab.
   * @param settings The current settings.
   */
  async pseudonymize(
    text: string,
    tabId: number,
    settings: Settings,
  ): Promise<void> {
    this.drop();
    this.error = null;
    this.waiting = { text, tabId, settings };
    if (this.owner && !this.owner.closed) await this.prepareWaiting();
    else this.deps.notify();
  }

  /**
   * The text the review was prepared from, to check the chat box still has it.
   *
   * @returns The source, or null if there's no review.
   */
  source(): ReviewSource | null {
    return this.review
      ? { tabId: this.review.tabId, text: this.review.text }
      : null;
  }

  /**
   * Save the approved review to the vault, and say how to apply it.
   *
   * @param settings The settings now; a review found under others is dropped.
   * @returns The tab, its original text, and the edits that pseudonymize it.
   */
  async approve(settings: Settings): Promise<Pseudonymized> {
    const review = this.review;
    const owner = this.owner;
    if (!review || !owner) throw failure("no_review");
    if (!sameChecks(review.settings, settings)) {
      this.drop();
      this.error = "settings_changed";
      this.deps.notify();
      throw failure("settings_changed");
    }
    this.review = null;
    try {
      const saved = await owner.commit(review.plan, { approved: true });
      this.touch();
      const preview = saved.previews[0];
      const edits: RedactEdit[] = preview.transformations
        .map((item) => ({
          start: item.sourceUtf16Range.start,
          end: item.sourceUtf16Range.end,
          replacement: preview.text.slice(
            item.outputUtf16Range.start,
            item.outputUtf16Range.end,
          ),
        }))
        .toSorted((a, b) => a.start - b.start);
      return {
        tabId: review.tabId,
        text: review.text,
        response: { text: preview.text, edits },
      };
    } catch (error) {
      // A failed save closes the workspace; lock, and settle it at unlock
      this.error = codeOf(error);
      if (!owner.closed) review.plan.discard();
      else {
        const requestId =
          typeof error === "object" && error !== null && "requestId" in error
            ? error.requestId
            : undefined;
        if (requestId instanceof Uint8Array) this.unsettled = requestId;
        this.owner = null;
        await this.vault?.lock();
      }
      this.deps.notify();
      throw error;
    }
  }

  /** Drop the review, and any Pseudonymize waiting for an unlock. */
  cancel(): void {
    this.turn++;
    this.drop();
    this.waiting = null;
    this.error = null;
    this.deps.notify();
  }

  /** Discard the review's plan, freeing the adapter's one slot. */
  private drop(): void {
    this.review?.plan.discard();
    this.review = null;
  }

  /** Prepare the waiting Pseudonymize, if there is one. */
  private async prepareWaiting(): Promise<void> {
    const waiting = this.waiting;
    const owner = this.owner;
    if (!waiting || !owner) return;
    this.waiting = null;
    const turn = ++this.turn;
    try {
      const found = await this.deps.findings(waiting.text, waiting.settings);
      // Cancelled or replaced while finding them
      if (turn !== this.turn) return;
      // Locked meanwhile: wait for the next unlock, as before one
      if (owner !== this.owner || owner.closed) {
        this.waiting = waiting;
        return;
      }
      const plan = owner.prepareReview(
        [{ text: waiting.text, scannerFindings: found, userSelections: [] }],
        this.deps.randomId(),
      );
      const preview = plan.preview();
      if (preview.transformations.length === 0) {
        plan.discard();
        this.error = "nothing_found";
      } else {
        this.review = {
          tabId: waiting.tabId,
          text: waiting.text,
          settings: waiting.settings,
          plan,
          items: preview.transformations.map((item) => ({
            original: waiting.text.slice(
              item.sourceUtf16Range.start,
              item.sourceUtf16Range.end,
            ),
            marker: preview.text.slice(
              item.outputUtf16Range.start,
              item.outputUtf16Range.end,
            ),
          })),
        };
      }
    } catch (error) {
      this.error = codeOf(error);
    }
    this.touch();
    this.deps.notify();
  }

  /** Restart the idle timer. */
  private touch(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      void this.lock(null).finally(() => this.deps.notify());
    }, IDLE_LOCK_MS);
  }
}
