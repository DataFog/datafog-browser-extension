/**
 * FogVault owns encrypted mappings; Core owns matching and workspace commits.
 * Normal access uses a non-exportable local device key without expiry. Legacy
 * password-only stores are unsupported. Original values
 * never leave the extension except as extension-owned local display.
 */

import type {
  FogVaultWorkspace,
  SavedWorkspaceChange,
  WorkspaceVaultPlan,
} from "@datafog/core-fogvault-browser";
import type {
  FogVault,
  KeyProvider,
  ProviderIdentity,
} from "@datafog/fogvault-browser";
import {
  transform,
  type WorkspaceFinding,
  type WorkspacePreview,
} from "@datafog/wasm";

import type {
  ApplyResponse,
  PdfFinding,
  PdfDraft,
  PdfPreviewChunk,
  PdfPreviewResponse,
  CreatedVault,
  KeepPlace,
  MarkedSensitive,
  Pseudonymized,
  RestoredValue,
  RestoredWithValues,
  RedactEdit,
  RedactResponse,
  ReviewItem,
  ReviewSource,
  ValueChoice,
  VaultRouting,
  VaultStatus,
} from "./messages";
import { sameChecks, type Settings } from "./settings";
import { identityOf, type Devices } from "./device";

/** The vault's name in IndexedDB. */
export const VAULT_NAME = "datafog";

/** Lock after this long without use, unless the device is remembered. */
export const IDLE_LOCK_MS = 15 * 60_000;

/** The longest delay setTimeout keeps; a longer one fires at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** The parts of FogVault the host uses. */
export type Vault = Pick<
  FogVault,
  | "create"
  | "open"
  | "lock"
  | "close"
  | "reconcileLatest"
  | "describeAccess"
  | "unlockDevice"
>;

/** The parts of Core's adapter the host uses. */
export type Owner = Pick<
  FogVaultWorkspace,
  | "prepareBatch"
  | "prepare"
  | "prepareReview"
  | "review"
  | "prepareForget"
  | "preparePolicyChanges"
  | "policy"
  | "commit"
  | "lock"
  | "closed"
  | "restoreReport"
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
  all?: { items: ReviewItem[]; ranges: KeepPlace[] };
  items: ReviewItem[];
  /** Each item's place in the text, in UTF-8 bytes, as Core counts. */
  ranges: { start: number; end: number }[];
  /** What the scan found, to pseudonymize one value on its own. */
  found: WorkspaceFinding[];
  /** The settings it was found under. */
  settings: Settings;
}

/** Pseudonymize asked for while the vault was locked. */
interface Waiting extends ReviewSource {
  settings: Settings;
}

/**
 * A review's source, to prepare it again.
 *
 * @param review The review.
 * @returns Its chat box text, tab and settings.
 */
function again({ tabId, text, settings }: Review): Waiting {
  return { tabId, text, settings };
}

/**
 * The edits a saved change makes to the chat box, in order.
 *
 * @param preview The change's preview of the text.
 * @returns The new text and each edit, in UTF-16 positions.
 */
function editsOf(preview: WorkspacePreview): RedactResponse {
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
  return { text: preview.text, edits };
}

/**
 * The scan's finding for one reviewed value: the one at its exact place, else
 * one inside it, else the value itself as the review showed it.
 *
 * @param found What the scan found.
 * @param range The value's place, in UTF-8 bytes.
 * @param item The reviewed value.
 * @returns The finding to pseudonymize.
 */
function findingAt(
  found: WorkspaceFinding[],
  range: { start: number; end: number },
  item: ReviewItem,
): WorkspaceFinding {
  const exact = found.find(
    (finding) =>
      finding.range.start === range.start && finding.range.end === range.end,
  );
  const inside = found.find(
    (finding) =>
      finding.range.start >= range.start && finding.range.end <= range.end,
  );
  return (
    exact ??
    inside ?? {
      entityType: item.entityType,
      matchedText: item.original,
      range: { unit: "utf8_bytes", ...range },
    }
  );
}

/**
 * The type a marker names, such as EMAIL for [[EMAIL_7KQ4ZM]].
 *
 * @param marker The marker.
 * @returns Its type.
 */
function labelOf(marker: string): string {
  return /^\[\[(.+)_[0-9A-Z]+\]\]$/.exec(marker)?.[1] ?? "";
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

/** One owner for commit outcome and the request that must be reconciled. */
type CommitState =
  | { phase: "idle" }
  | {
      phase: "saving" | "confirmed" | "uncertain" | "reconciling";
      requestId: Uint8Array;
    }
  | { phase: "failed"; error: string };
type DeletionState =
  | { phase: "idle" | "complete" }
  | {
      phase: "deleting" | "partial-failure";
      step: "vault" | "keys";
      error?: string;
    };

export class VaultHost<V extends Vault = Vault> {
  private vault: V | null = null;
  private opened = false;
  private owner: Owner | null = null;
  private review: Review | null = null;
  /** Core permits one prepared plan. A token prevents replacing a superseded preview. */
  private reservation: {
    id: string;
    tabId: number;
    revision: number;
    policyVersion: string;
  } | null = null;
  private pdfReservation: {
    plan: WorkspaceVaultPlan;
    response: PdfPreviewResponse;
    draftKey: string;
    settings: Settings;
    replaced: number;
  } | null = null;
  private waiting: Waiting | null = null;
  /** Counts review preparations, so a cancelled or replaced one is dropped. */
  private turn = 0;
  private error: string | null = null;
  private commitState: CommitState = { phase: "idle" };
  private deletionState: DeletionState = { phase: "idle" };
  private automatic = false;
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
      commit: this.commitState.phase,
      deletion: this.deletionState.phase,
      access: state === "unlocked" ? "ready" : "unavailable",
      waiting: this.waiting !== null,
      review: this.review?.items ?? null,
      reviewError: this.error,
      rememberedUntil: routing
        ? this.deps.devices.rememberedUntil(this.deps.now())
        : null,
      notSensitive: this.notSensitive(),
    };
  }

  /** Access uses existing keys and never silently replaces inaccessible data. */
  async automaticAccess(routing: VaultRouting | null): Promise<void> {
    this.automatic = true;
    clearTimeout(this.idle);
    if (!routing) throw failure("no_vault");
    if (this.owner && !this.owner.closed) return;
    // Retain legacy keys even when an old pause/expiry prevented use. They are
    // promoted only after a successful unwrap; no credential is fabricated.
    await this.unlockWithDevice(routing);
    if (!this.owner || this.owner.closed) throw failure("vault_key_missing");
    await this.deps.devices.promote?.();
  }

  async allowValue(entityType: string, value: string): Promise<void> {
    if (!this.owner || this.owner.closed) throw failure("vault_unavailable");
    this.drop();
    await this.saveChoice(this.owner, entityType, value, "not_sensitive");
    this.deps.notify();
  }

  /** Read-only review includes remembered originals without occupying Core's plan slot. */
  async pdfReview(text: string, settings: Settings): Promise<PdfFinding[]> {
    const owner = this.owner;
    if (!owner || owner.closed) throw failure("vault_unavailable");
    const found = await this.deps.findings(text, settings);
    if (owner !== this.owner || owner.closed)
      throw failure("vault_unavailable");
    const review = owner.review({
      text,
      scannerFindings: found,
      userSelections: [],
    });
    if (review.conflicts.length) throw failure("pdf_conflicting_findings");
    return review.candidates
      .filter((item) => item.selected)
      .map((item) => ({
        start: item.utf16Range.start,
        end: item.utf16Range.end,
        original: text.slice(item.utf16Range.start, item.utf16Range.end),
        entityType: item.finding.entityType,
        action: "replace",
      }));
  }

  /** Reserve a whole file in one Core batch; this does not commit any mapping. */
  async pdfPreview(
    chunks: PdfPreviewChunk[],
    draft: PdfDraft,
    settings: Settings,
    policyVersion: string,
  ): Promise<PdfPreviewResponse> {
    const owner = this.owner;
    if (!owner || owner.closed) throw failure("vault_unavailable");
    if (
      !Array.isArray(chunks) ||
      !chunks.length ||
      chunks.length > 200 ||
      new Set(chunks.map((chunk) => chunk.id)).size !== chunks.length ||
      chunks.some(
        (chunk) =>
          typeof chunk.id !== "string" ||
          typeof chunk.text !== "string" ||
          chunk.text.length > 10000 ||
          chunk.policyVersion !== policyVersion,
      ) ||
      chunks.reduce((total, chunk) => total + chunk.text.length, 0) > 1_000_000
    )
      throw failure("pdf_review_expired");
    const inputs = [];
    const redactions: RedactEdit[][] = [];
    let replaced = 0;
    for (const chunk of chunks) {
      const authoritative = await this.pdfReview(chunk.text, settings);
      if (
        !Array.isArray(chunk.findings) ||
        authoritative.length !== chunk.findings.length ||
        new Set(chunk.findings.map((item) => `${item.start}:${item.end}`))
          .size !== chunk.findings.length ||
        authoritative.some(
          (item) =>
            !chunk.findings.some(
              (chosen) =>
                chosen.start === item.start &&
                chosen.end === item.end &&
                chosen.original === item.original &&
                chosen.entityType === item.entityType &&
                ["replace", "redact", "keep"].includes(chosen.action),
            ),
        )
      )
        throw failure("pdf_review_expired");
      const findings = chunk.findings
        .filter((item) => item.action === "replace")
        .map((item) => ({
          entityType: item.entityType,
          matchedText: item.original,
          range: {
            unit: "utf8_bytes" as const,
            start: new TextEncoder().encode(chunk.text.slice(0, item.start))
              .length,
            end: new TextEncoder().encode(chunk.text.slice(0, item.end)).length,
          },
          detectorName: "workspace-review",
        }));
      replaced += findings.length;
      inputs.push({ text: chunk.text, findings });
      redactions.push(
        chunk.findings
          .filter((item) => item.action === "redact")
          .map((item) => ({
            start: item.start,
            end: item.end,
            replacement: transform(
              item.original,
              [
                {
                  entityType: item.entityType,
                  matchedText: item.original,
                  byteRange: {
                    start: 0,
                    end: new TextEncoder().encode(item.original).length,
                  },
                  codepointRange: {
                    start: 0,
                    end: Array.from(item.original).length,
                  },
                  detectorName: "workspace-review",
                },
              ],
              { default: { strategy: "redact" } },
            ).text,
          })),
      );
    }
    if (owner !== this.owner || owner.closed)
      throw failure("vault_unavailable");
    this.drop();
    const plan = owner.prepareBatch(inputs, this.deps.randomId());
    try {
      const previews = plan.previews();
      if (previews.length !== chunks.length)
        throw failure("pdf_review_expired");
      const response: PdfPreviewResponse = {
        previewId: crypto.randomUUID(),
        policyVersion,
        chunks: previews.map((preview, index) => {
          const edits = [
            ...editsOf(preview).edits,
            ...redactions[index],
          ].toSorted((a, b) => a.start - b.start);
          let text = chunks[index].text;
          for (const edit of edits.toReversed())
            text =
              text.slice(0, edit.start) +
              edit.replacement +
              text.slice(edit.end);
          return { id: chunks[index].id, text, edits };
        }),
      };
      this.pdfReservation = {
        plan,
        response,
        draftKey: JSON.stringify(draft),
        settings,
        replaced,
      };
      return response;
    } catch (error) {
      plan.discard();
      throw error;
    }
  }

  /** Commit the exact displayed batch; never regenerate a token at insertion. */
  async pdfApply(
    previewId: string,
    draft: PdfDraft,
    settings: Settings,
    policyVersion: string,
  ): Promise<PdfPreviewResponse & { saved: boolean }> {
    const reserved = this.pdfReservation;
    const owner = this.owner;
    if (
      !reserved ||
      !owner ||
      owner.closed ||
      reserved.response.previewId !== previewId ||
      reserved.response.policyVersion !== policyVersion ||
      reserved.draftKey !== JSON.stringify(draft) ||
      !sameChecks(reserved.settings, settings)
    )
      throw failure("pdf_review_expired");
    this.pdfReservation = null;
    if (reserved.replaced) await this.save(owner, reserved.plan);
    else reserved.plan.discard();
    return { ...reserved.response, saved: reserved.replaced > 0 };
  }

  /** An old panel cannot cancel another panel's or a paste's reservation. */
  pdfCancel(previewId: string): void {
    if (this.pdfReservation?.response.previewId !== previewId) return;
    this.pdfReservation.plan.discard();
    this.pdfReservation = null;
  }

  /** Retain the exact Core allocation until consumed or explicitly superseded. */
  async preview(
    text: string,
    settings: Settings,
    tabId = -1,
    revision = 0,
    policyVersion = "",
    keep?: KeepPlace[],
    redactions?: KeepPlace[],
  ): Promise<{ findings: ReviewItem[]; previewId?: string }> {
    if (
      !this.review ||
      this.review.text !== text ||
      this.reservation?.tabId !== tabId ||
      this.reservation.policyVersion !== policyVersion ||
      !sameChecks(this.review.settings, settings)
    ) {
      await this.pseudonymize(text, tabId, settings);
    }
    if (this.error && this.error !== "nothing_found") throw failure(this.error);
    const findings =
      (this.review?.all?.items ?? this.review?.items)?.map((item) => ({
        ...item,
      })) ?? [];
    this.waiting = null;
    this.error = null;
    if (!this.review) return { findings };
    const previewId = crypto.randomUUID();
    this.reservation = { id: previewId, tabId, revision, policyVersion };
    if (keep || redactions)
      return this.select(
        text,
        settings,
        tabId,
        previewId,
        policyVersion,
        (keep ?? []).filter((place) =>
          findings.some(
            (item) => item.start === place.start && item.end === place.end,
          ),
        ),
        redactions,
      );
    return { findings, previewId };
  }

  /** Refresh an exact reservation for chosen occurrences, never by value. */
  async select(
    text: string,
    settings: Settings,
    tabId: number,
    previewId: string,
    policyVersion: string,
    keep: KeepPlace[],
    redactions: KeepPlace[] = [],
  ): Promise<{ findings: ReviewItem[]; previewId: string }> {
    const review = this.review;
    const owner = this.owner;
    if (
      !review ||
      !owner ||
      owner.closed ||
      review.text !== text ||
      this.reservation?.id !== previewId ||
      this.reservation.tabId !== tabId ||
      this.reservation.policyVersion !== policyVersion ||
      !sameChecks(review.settings, settings)
    )
      throw failure("preview_expired");
    const reservation = this.reservation;
    const all = review.all ?? { items: review.items, ranges: review.ranges };
    if (
      !Array.isArray(keep) ||
      !Array.isArray(redactions) ||
      [...keep, ...redactions].some(
        (place) =>
          !place ||
          !Number.isInteger(place.start) ||
          !Number.isInteger(place.end) ||
          !all.items.some(
            (item) => item.start === place.start && item.end === place.end,
          ),
      )
    )
      throw failure("selection_invalid");
    const modes = [...keep, ...redactions];
    if (
      new Set(modes.map((place) => `${place.start}:${place.end}`)).size !==
      modes.length
    )
      throw failure("selection_invalid");
    const items = all.items.map<ReviewItem>((item) => ({
      ...item,
      kept: keep.some(
        (place) => place.start === item.start && place.end === item.end,
      ),
      action: keep.some(
        (place) => place.start === item.start && place.end === item.end,
      )
        ? "keep"
        : redactions.some(
              (place) => place.start === item.start && place.end === item.end,
            )
          ? "redact"
          : "replace",
      marker: "",
    }));
    for (const item of items) {
      if (item.action !== "redact") continue;
      // Core owns label formatting, including values recalled from saved mappings.
      // Only the authoritative reserved value/type is used, never client labels.
      item.marker = transform(
        item.original,
        [
          {
            entityType: item.entityType,
            matchedText: item.original,
            byteRange: {
              start: 0,
              end: new TextEncoder().encode(item.original).length,
            },
            codepointRange: { start: 0, end: Array.from(item.original).length },
            detectorName: "workspace-review",
          },
        ],
        { default: { strategy: "redact" } },
      ).text;
    }
    const chosen = items.flatMap((item, index) =>
      item.action === "replace" ? [index] : [],
    );
    this.drop();
    const plan = owner.prepare(
      text,
      chosen.map((index) =>
        findingAt(review.found, all.ranges[index], all.items[index]),
      ),
      this.deps.randomId(),
    );
    const preview = plan.preview();
    if (preview.transformations.length !== chosen.length) {
      plan.discard();
      throw failure("preview_expired");
    }
    for (const change of preview.transformations) {
      const item = items.find(
        (candidate) =>
          candidate.action === "replace" &&
          candidate.start === change.sourceUtf16Range.start &&
          candidate.end === change.sourceUtf16Range.end,
      );
      if (!item) {
        plan.discard();
        throw failure("preview_expired");
      }
      item.marker = preview.text.slice(
        change.outputUtf16Range.start,
        change.outputUtf16Range.end,
      );
    }
    this.review = {
      ...review,
      plan,
      items: chosen.map((index) => items[index]),
      ranges: chosen.map((index) => all.ranges[index]),
      all: { items, ranges: all.ranges },
    };
    const next = crypto.randomUUID();
    this.reservation = { ...reservation, id: next };
    return { findings: items, previewId: next };
  }

  /** Retire one exact saved marker through Core's durable commit boundary. */
  async forget(marker: string): Promise<void> {
    const owner = this.owner;
    if (!owner || owner.closed) throw failure("vault_unavailable");
    const code = /^\[\[[A-Z][A-Z0-9_]*_([0-9A-HJKMNP-TV-Z]{6})\]\]$/.exec(
      marker,
    )?.[1];
    if (!code) throw failure("invalid_marker");
    this.drop();
    await this.save(owner, owner.prepareForget([code], this.deps.randomId()));
    this.deps.notify();
  }

  async replace(
    text: string,
    tabId: number,
    settings: Settings,
    previewId?: string,
    policyVersion = "",
  ): Promise<RedactResponse & { saved: true }> {
    if (previewId) {
      if (
        !this.review ||
        this.review.text !== text ||
        this.reservation?.id !== previewId ||
        this.reservation.tabId !== tabId ||
        this.reservation.policyVersion !== policyVersion ||
        !sameChecks(this.review.settings, settings)
      )
        throw failure("preview_expired");
    } else {
      await this.pseudonymize(text, tabId, settings);
    }
    if (!this.review || this.review.items.length === 0)
      throw failure(this.error ?? "nothing_found");
    const saved = await this.approve(settings);
    this.reservation = null;
    return { ...saved.response, saved: true };
  }

  /** Apply reserved per-occurrence modes after the one durable Replace commit. */
  async apply(
    text: string,
    tabId: number,
    settings: Settings,
    previewId: string,
    policyVersion: string,
  ): Promise<ApplyResponse> {
    const review = this.review;
    if (
      !review ||
      !this.owner ||
      this.owner.closed ||
      review.text !== text ||
      this.reservation?.id !== previewId ||
      this.reservation.tabId !== tabId ||
      this.reservation.policyVersion !== policyVersion ||
      !sameChecks(review.settings, settings)
    )
      throw failure("preview_expired");
    const items = review.all?.items ?? review.items;
    const redactions: RedactEdit[] = items
      .filter((item) => item.action === "redact")
      .map((item) => ({
        start: item.start!,
        end: item.end!,
        replacement: item.marker,
      }));
    const planned = editsOf(review.plan.preview()).edits;
    const edits = [...planned, ...redactions].toSorted(
      (a, b) => a.start - b.start,
    );
    if (!edits.length) throw failure("nothing_found");
    if (
      edits.some(
        (edit, index) =>
          !Number.isInteger(edit.start) ||
          !Number.isInteger(edit.end) ||
          edit.start < 0 ||
          edit.end <= edit.start ||
          edit.end > text.length ||
          (index > 0 && edits[index - 1].end > edit.start),
      )
    )
      throw failure("selection_invalid");
    let response: RedactResponse;
    if (planned.length)
      response = await this.replace(
        text,
        tabId,
        settings,
        previewId,
        policyVersion,
      );
    else {
      this.drop();
      response = { text, edits: [] };
    }
    const combined = [...response.edits, ...redactions].toSorted(
      (a, b) => a.start - b.start,
    );
    let result = text;
    for (const edit of combined.toReversed())
      result =
        result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    return {
      text: result,
      edits: combined,
      applied: true,
      saved: planned.length > 0,
      replaced: planned.length,
      redacted: redactions.length,
    };
  }

  /**
   * The values marked not sensitive, while unlocked.
   *
   * @returns Each value and its type; empty while locked.
   */
  notSensitive(): ValueChoice[] {
    if (!this.owner || this.owner.closed) return [];
    return this.owner
      .policy()
      .choices.filter((choice) => choice.disposition === "not_sensitive")
      .map(({ entityType, value }) => ({ entityType, value }));
  }

  /**
   * Remember a reviewed value as not sensitive, and prepare the review again
   * without it. Core leaves the value as is from then on.
   *
   * @param index The value's place in the review.
   */
  async markNotSensitive(index: number): Promise<void> {
    const review = this.review;
    const owner = this.owner;
    const item = review?.items[index];
    if (!review || !owner || !item) throw failure("no_review");
    this.drop();
    this.waiting = again(review);
    await this.saveChoice(
      owner,
      item.entityType,
      item.original,
      "not_sensitive",
    );
    await this.prepareWaiting();
  }

  /**
   * Forget that a value is not sensitive, so it's replaced again. An open
   * review is prepared again, since the value may be in it.
   *
   * @param choice The value and its type.
   */
  async clearChoice(choice: ValueChoice): Promise<void> {
    const owner = this.owner;
    if (!owner || owner.closed) throw failure("vault_locked");
    if (this.review) {
      this.waiting = again(this.review);
      this.drop();
    }
    await this.saveChoice(owner, choice.entityType, choice.value, null);
    if (this.waiting) await this.prepareWaiting();
    else this.deps.notify();
  }

  /**
   * Save one value's choice to the vault.
   *
   * @param owner The workspace.
   * @param entityType The value's type.
   * @param value The value.
   * @param disposition Not sensitive, or null to forget the choice.
   */
  private async saveChoice(
    owner: Owner,
    entityType: string,
    value: string,
    disposition: "not_sensitive" | null,
  ): Promise<void> {
    const plan = owner.preparePolicyChanges(
      { rules: [], choices: [{ entityType, value, disposition }] },
      this.deps.randomId(),
    );
    await this.save(owner, plan);
  }

  /**
   * Save a prepared change. A failed save closes the workspace, so the vault
   * locks, and the change is settled at the next unlock.
   *
   * @param owner The workspace.
   * @param plan The change.
   * @returns What was saved.
   */
  private async save(
    owner: Owner,
    plan: WorkspaceVaultPlan,
  ): Promise<SavedWorkspaceChange> {
    const requestId = this.deps.randomId();
    this.commitState = { phase: "saving", requestId };
    try {
      const saved = await owner.commit(plan, { approved: true, requestId });
      this.commitState = { phase: "confirmed", requestId };
      this.touch();
      return saved;
    } catch (error) {
      this.error = codeOf(error);
      this.waiting = null;
      if (!owner.closed) {
        plan.discard();
        this.commitState = { phase: "failed", error: this.error };
      } else {
        const reportedId =
          typeof error === "object" && error !== null && "requestId" in error
            ? error.requestId
            : undefined;
        this.commitState = {
          phase: "uncertain",
          requestId: reportedId instanceof Uint8Array ? reportedId : requestId,
        };
        this.owner = null;
        await this.vault?.lock();
      }
      this.deps.notify();
      throw error;
    }
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
    if (
      this.commitState.phase === "uncertain" ||
      this.commitState.phase === "reconciling"
    ) {
      const { requestId } = this.commitState;
      this.commitState = { phase: "reconciling", requestId };
      try {
        await vault.reconcileLatest(requestId);
        // Reconciliation establishes the current head, not that the lost
        // operation committed. Only a returned commit receipt confirms it.
        this.commitState = { phase: "idle" };
      } catch (error) {
        this.commitState = { phase: "uncertain", requestId };
        throw error;
      }
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
    if (!this.automatic) await devices.prune(this.deps.now());
    const device = this.automatic
      ? (devices.existing?.() ?? devices.active(this.deps.now()))
      : devices.active(this.deps.now());
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
      // Preserve keys on corruption/transient failures: retries must be safe.
      throw failure("vault_access_failed");
    }
  }

  /**
   * Make a device key, closing the vault so the next one knows it.
   *
   * @returns The key's identity.
   */
  private async newDevice(): Promise<ProviderIdentity> {
    const existing = this.deps.devices.existing?.();
    if (existing) return identityOf(existing.keyId);
    const identity = await this.deps.devices.create(this.deps.now());
    await this.dropVault();
    return identity;
  }

  /**
   * Create the vault and its workspace, leaving it unlocked.
   *
   * Every vault starts with a device slot, so remembering a device later keeps
   * its keys; without Remember, that key is deleted at once. There's no
   * recovery key: a forgotten password means deleting the vault.
   *
   * @param password The new password.
   * @param routing Existing routing, if a vault was already created.
   * @param remember Whether to remember this device for 30 days.
   * @returns The status and the new routing.
   */
  async create(
    password: string,
    routing: VaultRouting | null,
    remember: boolean,
  ): Promise<CreatedVault> {
    if (routing) throw failure("vault_exists");
    const identity = await this.newDevice();
    const vault = this.ensureVault();
    await vault.create(VAULT_NAME, password, {
      recovery: false,
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
    const made = {
      recordId: toBase64(route.recordId),
      namespace: toBase64(route.namespace),
    };
    this.touch();
    await this.prepareWaiting();
    return { status: this.status(made), routing: made };
  }

  /**
   * Forget this device, so the vault needs the password again.
   *
   * @param routing Where the workspace lives.
   * @returns The status.
   */
  async forgetDevice(routing: VaultRouting | null): Promise<VaultStatus> {
    await this.deps.devices.forget();
    // Without the device, an open vault locks after idling again
    if (this.owner && !this.owner.closed) this.touch();
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
   * Delete the vault and everything in it. No password is needed: deleting
   * reveals nothing, and someone who forgot their password must still be
   * able to start over. The side panel asks them to confirm.
   *
   * @param routing Where the workspace lives.
   * @returns The status, with no vault.
   */
  async deleteVault(routing: VaultRouting | null): Promise<VaultStatus> {
    // The background's durable tombstone survives restart; this state owns
    // the current attempt and never claims completion before key cleanup.
    let step: "vault" | "keys" =
      this.deletionState.phase === "partial-failure"
        ? this.deletionState.step
        : "vault";
    this.deletionState = { phase: "deleting", step };
    try {
      await this.lock(routing);
      await this.dropVault();
      if (step === "vault") await this.deps.deleteStore(VAULT_NAME);
      step = "keys";
      this.deletionState = { phase: "deleting", step };
      await this.deps.devices.clear();
      this.commitState = { phase: "idle" };
      this.error = null;
      this.deletionState = { phase: "complete" };
      this.deps.notify();
      return this.status(null);
    } catch (error) {
      this.deletionState = {
        phase: "partial-failure",
        step,
        error: codeOf(error),
      };
      throw error;
    }
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
    const saved = await this.save(owner, review.plan);
    return {
      tabId: review.tabId,
      text: review.text,
      response: editsOf(saved.previews[0]),
    };
  }

  /**
   * Pseudonymize one value from the review on its own, and save it to the
   * vault. The review is dropped; the caller prepares one of the values left
   * once the chat box has changed.
   *
   * @param index The value's place in the review.
   * @param settings The settings now; a review found under others is dropped.
   * @returns The tab, its original text, the edit that pseudonymizes the value,
   *   and how many values the review had left.
   */
  async markSensitive(
    index: number,
    settings: Settings,
  ): Promise<MarkedSensitive> {
    const review = this.review;
    const owner = this.owner;
    const item = review?.items[index];
    const range = review?.ranges[index];
    if (!review || !owner || !item || !range) throw failure("no_review");
    if (!sameChecks(review.settings, settings)) {
      this.drop();
      this.error = "settings_changed";
      this.deps.notify();
      throw failure("settings_changed");
    }
    // The adapter holds one prepared change at a time. A new value's marker
    // depends on its place among the values saved, so saved on its own it
    // may differ from the one the review showed
    this.drop();
    const plan = owner.prepare(
      review.text,
      [findingAt(review.found, range, item)],
      this.deps.randomId(),
    );
    const saved = await this.save(owner, plan);
    return {
      tabId: review.tabId,
      text: review.text,
      response: editsOf(saved.previews[0]),
      remaining: review.items.length - 1,
    };
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
    this.reservation = null;
    this.pdfReservation?.plan.discard();
    this.pdfReservation = null;
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
        [
          {
            text: waiting.text,
            scannerFindings: found,
            userSelections: [],
          },
        ],
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
          found,
          ranges: preview.transformations.map(({ sourceByteRange }) => ({
            start: sourceByteRange.start,
            end: sourceByteRange.end,
          })),
          items: preview.transformations.map((item) => ({
            start: item.sourceUtf16Range.start,
            end: item.sourceUtf16Range.end,
            entityType: labelOf(
              preview.text.slice(
                item.outputUtf16Range.start,
                item.outputUtf16Range.end,
              ),
            ),
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
    if (this.automatic) return;
    // A remembered device keeps the vault open until its 30 days end
    const now = this.deps.now();
    const until = this.deps.devices.active(now)
      ? this.deps.devices.rememberedUntil(now)
      : null;
    const delay =
      until === null ? IDLE_LOCK_MS : Math.min(until - now, MAX_TIMEOUT_MS);
    this.idle = setTimeout(() => {
      // A long wait comes in parts; lock once the device is no longer active
      if (until !== null && this.deps.devices.active(this.deps.now())) {
        this.touch();
        return;
      }
      void this.lock(null).finally(() => this.deps.notify());
    }, delay);
  }
}
