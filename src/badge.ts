/**
 * The inline badge in the chat box, and its expandable panel.
 *
 * Like Grammarly's: a small DataFog logo just outside the chat box
 * that turns into a red count when something sensitive is found. Lives in a
 * shadow root so ChatGPT's styles can't reach it and its styles can't leak
 * into the page. Shows types and counts only, never values.
 */

import { LOGO } from "./logo";
import { LABELS } from "./settings";

const REPORT_URL =
  "https://github.com/DataFog/datafog-browser-extension/issues";
const HELP_EMAIL = "help@datafog.ai";

export type BadgeState =
  | { kind: "hidden" }
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "clean" }
  | {
      kind: "failed";
      code?: string;
      counts?: Record<string, number>;
      /** What failed, when it was an action on found values. */
      action?: "redact" | "pseudonymize";
    }
  | { kind: "found"; counts: Record<string, number> };

const STYLE = `
  :host { all: initial; }
  .wrap {
    position: fixed; z-index: 2147483647; display: flex;
    flex-direction: column-reverse; align-items: flex-end; gap: 8px;
    font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .dot {
    width: 24px; height: 24px; padding: 0; border: 0; border-radius: 999px;
    display: grid; place-items: center; cursor: pointer; background: none;
  }
  .dot svg { display: block; }
  .dots {
    display: flex; gap: 2px; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 5px; background: #1A2226;
  }
  .dots i {
    width: 4px; height: 4px; border-radius: 999px; background: #A7B2B1;
    animation: pulse 1s ease-in-out infinite;
  }
  .dots i:nth-child(2) { animation-delay: 150ms; }
  .dots i:nth-child(3) { animation-delay: 300ms; }
  .dot.found {
    background: #d93025; color: #fff; font-weight: 700; font-size: 12px;
    box-shadow: 0 1px 4px rgba(217, 48, 37, 0.45);
  }
  .dot.failed {
    background: #b06000; color: #fff; font-weight: 700; font-size: 13px;
    box-shadow: 0 1px 4px rgba(176, 96, 0, 0.45);
  }
  @keyframes pulse { 50% { opacity: 0.3; } }
  @media (prefers-reduced-motion: reduce) {
    .dots i { animation: none; }
  }
  .panel {
    width: 280px; border: 1px solid #d0d0d0; border-radius: 12px;
    background: #fff; color: #1f1f1f; padding: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
  }
  .panel h2 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
  .panel ul { margin: 0 0 8px; padding-left: 18px; }
  .note { margin: 0; color: #666; font-size: 12px; }
  .files, .paused {
    margin: 0 0 8px; color: #b06000; font-size: 12px; font-weight: 600;
  }
  .report { margin: 8px 0 0; color: #666; font-size: 12px; }
  .report a { color: inherit; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .send { flex-basis: 100%; }
  .dismiss { margin-left: auto; }
  button.act {
    border-radius: 8px; padding: 6px 10px; cursor: pointer; font: inherit;
    border: 1px solid #d0d0d0; background: #fff; color: #1f1f1f;
  }
  button.primary { background: #1f1f1f; color: #fff; border-color: #1f1f1f; }
  button.act:disabled { opacity: 0.4; cursor: default; }
  [hidden] { display: none !important; }
`;

const ACTIONS = [
  "redact",
  "pseudonymize",
  "dismiss",
  "undo",
  "redo",
  "send",
] as const;
type Action = (typeof ACTIONS)[number];

const DOTS = '<span class="dots"><i></i><i></i><i></i></span>';

/** The badge's size, and its gap from the chat box, in pixels. */
const DOT_SIZE = 24;
const GAP = 8;

/** Lines the badge up with a one-line chat box's center, or the send button. */
const BOTTOM_INSET = 14;

/** Room needed beside the chat box, clear of the page tab, in pixels. */
const SIDE_ROOM = 72;

/** A box in viewport coordinates. */
interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The part of an element that's on screen: its box clipped by every
 * scrolling or clipping ancestor below the page body, and by the viewport,
 * which clips the page itself.
 *
 * @param element The element.
 * @returns The visible box, or null when none of it is on screen.
 */
function visibleBox(element: Element): Box | null {
  let { top, right, bottom, left } = element.getBoundingClientRect();
  for (
    let parent = element.parentElement;
    parent && parent !== document.body;
    parent = parent.parentElement
  ) {
    if (getComputedStyle(parent).overflowY === "visible") continue;
    const clip = parent.getBoundingClientRect();
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
    left = Math.max(left, clip.left);
  }
  top = Math.max(top, 0);
  right = Math.min(right, window.innerWidth);
  bottom = Math.min(bottom, window.innerHeight);
  left = Math.max(left, 0);
  return bottom > top && right > left ? { top, right, bottom, left } : null;
}

/**
 * Pluralize a count of items.
 *
 * @param count How many.
 * @returns "1 item" or "N items".
 */
function items(count: number): string {
  return `${count} item${count === 1 ? "" : "s"}`;
}

export class Badge {
  private readonly host = document.createElement("datafog-badge");
  private readonly wrap: HTMLDivElement;
  private readonly dot: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly list: HTMLUListElement;
  private readonly files: HTMLParagraphElement;
  private readonly paused: HTMLParagraphElement;
  private readonly note: HTMLParagraphElement;
  private readonly report: HTMLParagraphElement;
  private readonly buttons: Record<Action, HTMLButtonElement>;
  private history: { undo: boolean; redo: boolean } = {
    undo: false,
    redo: false,
  };
  private anchor: Element | null = null;
  private kind: BadgeState["kind"] = "hidden";
  private resize = new ResizeObserver(() => this.reposition());
  private frame = 0;

  /**
   * Build the badge and wire its buttons.
   *
   * @param actions What to do for each button.
   */
  constructor(actions: Record<Action, () => void>) {
    const root = this.host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="wrap" hidden>
        <button class="dot" type="button"></button>
        <div class="panel" hidden>
          <p class="files" hidden>Attached files aren't protected. DataFog only checks text in the chat box.</p>
          <p class="paused" hidden></p>
          <h2></h2>
          <ul></ul>
          <p class="note"></p>
          <p class="report" hidden>
            <a href="${REPORT_URL}" target="_blank" rel="noreferrer">Report this problem</a>
            or email <a href="mailto:${HELP_EMAIL}">${HELP_EMAIL}</a>
          </p>
          <div class="actions">
            <button class="act undo" type="button"
              title="Put back the values DataFog replaced.">Undo</button>
            <button class="act redo" type="button"
              title="Replace the same values again.">Redo</button>
            <button class="act dismiss" type="button"
              title="Hide this warning. Send with ChatGPT's own button.">Dismiss</button>
            <button class="act pseudonymize" type="button"
              title="Replace each value with a marker, keeping the original in your vault so it can be restored.">Pseudonymize</button>
            <button class="act primary redact" type="button">Redact</button>
            <button class="act send" type="button" hidden>Send anyway</button>
          </div>
        </div>
      </div>`;

    this.wrap = root.querySelector(".wrap")!;
    this.dot = root.querySelector(".dot")!;
    this.panel = root.querySelector(".panel")!;
    this.title = root.querySelector("h2")!;
    this.list = root.querySelector("ul")!;
    this.files = root.querySelector(".files")!;
    this.paused = root.querySelector(".paused")!;
    this.note = root.querySelector(".note")!;
    this.report = root.querySelector(".report")!;

    this.dot.addEventListener("click", () => {
      if (this.kind !== "checking") this.panel.hidden = !this.panel.hidden;
    });
    this.buttons = {
      redact: root.querySelector(".redact")!,
      pseudonymize: root.querySelector(".pseudonymize")!,
      dismiss: root.querySelector(".dismiss")!,
      undo: root.querySelector(".undo")!,
      redo: root.querySelector(".redo")!,
      send: root.querySelector(".send")!,
    };
    for (const action of ACTIONS) {
      this.buttons[action].addEventListener("click", () => {
        // Undo and Redo can be repeated; the others resolve the warning
        if (action !== "undo" && action !== "redo") this.panel.hidden = true;
        actions[action]();
      });
    }

    // Close the panel on a click anywhere else, as Grammarly does
    document.addEventListener("pointerdown", (event) => {
      if (!event.composedPath().includes(this.host)) this.panel.hidden = true;
    });
    window.addEventListener("resize", () => this.reposition());
    window.addEventListener("scroll", () => this.reposition(), true);
    document.documentElement.append(this.host);
  }

  /**
   * Follow a (possibly new) chat box.
   *
   * @param anchor The element to sit beside.
   */
  attach(anchor: Element): void {
    if (anchor === this.anchor) return;
    this.resize.disconnect();
    this.anchor = anchor;
    this.resize.observe(anchor);
    this.place();
  }

  /**
   * Show a state.
   *
   * @param state What to show.
   */
  show(state: BadgeState): void {
    // Keep a red count steady while rechecking, rather than flicker to the logo,
    // an open panel steady too, and don't bring back a badge the user turned off
    if (
      state.kind === "checking" &&
      (this.kind === "found" || this.kind === "hidden" || !this.panel.hidden)
    )
      return;
    this.kind = state.kind;
    this.wrap.hidden = state.kind === "hidden";
    this.dot.className = `dot ${state.kind}`;

    if (state.kind === "found") {
      const total = Object.values(state.counts).reduce(
        (sum, count) => sum + count,
        0,
      );
      this.dot.textContent = total > 99 ? "99+" : String(total);
      this.dot.title = `DataFog: ${items(total)} found. Click to review.`;
      this.title.textContent = `${items(total)} you may not want to share`;
      this.listCounts(state.counts);
    } else if (state.kind === "failed") {
      // Say so rather than look like a check still running
      const updated = state.code === "extension_reloaded";
      const action = state.action ?? (state.counts ? "redact" : "check");
      const title = updated
        ? "DataFog was updated"
        : `DataFog couldn't ${action} this text`;
      this.dot.textContent = "!";
      this.dot.title = `${title}. Click for details.`;
      this.title.textContent = title;
      this.listCounts(state.counts ?? {});
    } else {
      this.dot.innerHTML = state.kind === "checking" ? DOTS : LOGO;
      if (state.kind === "checking") this.dot.title = "DataFog is checking";
      else
        this.dot.title =
          state.kind === "clean"
            ? "DataFog: no sensitive data found"
            : "DataFog";
      this.title.textContent =
        state.kind === "clean"
          ? "No sensitive data found"
          : "DataFog is checking this chat box";
      this.list.replaceChildren();
      if (state.kind === "hidden") this.panel.hidden = true;
    }

    if (state.kind === "failed" && state.code === "extension_reloaded") {
      this.note.textContent =
        "Reload this page to keep checking this chat box.";
    } else if (state.kind === "failed") {
      // The code alone says what went wrong, without any of the text
      const action = state.counts
        ? "Remove these before sending, or reload the page to try again."
        : "Reload the page to try again.";
      this.note.textContent = state.code
        ? `${action} Error code: ${state.code}`
        : action;
    } else {
      this.note.textContent =
        "Checked on this device by DataFog. Nothing was sent.";
    }
    // Reloading fixes an update, so there's nothing to report
    this.report.hidden =
      state.kind !== "failed" || state.code === "extension_reloaded";
    this.list.hidden = this.list.childElementCount === 0;
    this.showActions();
    this.dot.setAttribute("aria-label", this.dot.title);
    this.place();
  }

  /**
   * Warn that attached files aren't protected, opening the panel to say so,
   * or take the warning down.
   *
   * @param attached Whether files are attached.
   */
  warnFiles(attached: boolean): void {
    const warned = !this.files.hidden;
    this.files.hidden = !attached;
    if (attached) this.panel.hidden = this.kind === "hidden";
    else if (warned) this.panel.hidden = true;
  }

  /**
   * Say why a send was held and offer Send anyway, or take that down.
   *
   * @param reason Why it was held, or null if it no longer is.
   */
  holdSend(reason: string | null): void {
    this.paused.textContent = reason;
    this.paused.hidden = reason === null;
    this.buttons.send.hidden = reason === null;
    if (reason !== null) this.panel.hidden = false;
  }

  /**
   * Set which of Undo and Redo the panel offers.
   *
   * @param history Whether each is available.
   */
  offer(history: { undo: boolean; redo: boolean }): void {
    this.history = history;
    this.showActions();
  }

  /** Keep Undo and Redo in place, greyed out when unavailable. */
  private showActions(): void {
    const found = this.kind === "found";
    this.buttons.redact.hidden = !found;
    this.buttons.pseudonymize.hidden = !found;
    this.buttons.dismiss.hidden = !found;
    this.buttons.undo.disabled = !this.history.undo;
    this.buttons.redo.disabled = !this.history.redo;
  }

  /**
   * List what was found, by type.
   *
   * @param counts How many of each type.
   */
  private listCounts(counts: Record<string, number>): void {
    this.list.replaceChildren(
      ...Object.entries(counts).map(([type, count]) => {
        const item = document.createElement("li");
        item.textContent = `${LABELS[type] ?? type}: ${count}`;
        return item;
      }),
    );
  }

  /**
   * Move the badge on the next frame, for when the chat box may have moved.
   * Many calls in one frame cost one layout.
   */
  reposition(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.place();
    });
  }

  /**
   * Keep the badge just outside the chat box: beside its bottom-right corner,
   * or above that corner when there's no room beside it.
   */
  private place(): void {
    if (!this.anchor) return;
    const box = visibleBox(this.anchor);
    this.wrap.style.visibility = box ? "" : "hidden";
    if (!box) return;
    const fromRight = window.innerWidth - box.right;
    const fromBottom = window.innerHeight - box.bottom;
    const beside = fromRight >= SIDE_ROOM;
    this.wrap.style.right = `${beside ? fromRight - GAP - DOT_SIZE : fromRight + GAP}px`;
    this.wrap.style.bottom = `${
      beside
        ? fromBottom + BOTTOM_INSET
        : Math.min(
            window.innerHeight - box.top + GAP,
            window.innerHeight - DOT_SIZE - GAP,
          )
    }px`;
  }
}
