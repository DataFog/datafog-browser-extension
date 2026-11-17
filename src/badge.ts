/**
 * The inline badge in the chat box, and its expandable panel.
 *
 * Like Grammarly's: a small DataFog badge just outside the chat box, the
 * size and shape of the site's own buttons, that turns into a red count when
 * something sensitive is found. Lives in a
 * shadow root so the site's styles can't reach it and its styles can't leak
 * into the page. Shows types and counts only, never values.
 */

import { MARK } from "./logo";
import { LABELS } from "./settings";
import { siteFor, type BadgeShape, type Site } from "./site";

const HELP_EMAIL = "help@datafog.ai";

/** Why the badge is greyed out, on hover. */
export const OFF_TITLE = "DataFog is disabled in the settings for this site.";

export type BadgeState =
  | { kind: "hidden" }
  /** Checking is turned off in settings. */
  | { kind: "off" }
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

/** The badge's gap from the chat box, in pixels. */
const GAP = 8;

/** Room the page tab takes at the page's right edge, in pixels. */
const TAB_ROOM = 40;

const STYLE = `
  :host { all: initial; }
  .wrap {
    position: fixed; z-index: 2147483647; display: flex;
    flex-direction: column-reverse; align-items: flex-end; gap: 8px;
    font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .dot {
    box-sizing: border-box; flex: none; width: var(--size);
    height: var(--size); padding: 0; border: 0; border-radius: var(--radius);
    display: grid; place-items: center; cursor: pointer;
    background: #1A2226; color: #fff; font-family: inherit;
    font-size: calc(var(--size) * 0.4); font-weight: 700; line-height: 1;
  }
  .dot svg { display: block; }
  .dots { display: flex; gap: 3px; align-items: center; }
  .dots i {
    width: 5px; height: 5px; border-radius: 50%; background: #A7B2B1;
    animation: pulse 1s ease-in-out infinite;
  }
  .dots i:nth-child(2) { animation-delay: 150ms; }
  .dots i:nth-child(3) { animation-delay: 300ms; }
  .dot.found {
    background: #d93025; box-shadow: 0 1px 4px rgba(217, 48, 37, 0.45);
  }
  .dot.off { filter: grayscale(1); opacity: 0.4; cursor: default; }
  .dot.failed {
    background: #b06000; box-shadow: 0 1px 4px rgba(176, 96, 0, 0.45);
  }
  @keyframes pulse { 50% { opacity: 0.3; } }
  @media (prefers-reduced-motion: reduce) {
    .dots i { animation: none; }
  }
  .panel {
    position: fixed; box-sizing: border-box;
    width: min(306px, calc(100vw - 16px)); overflow: auto;
    border: 1px solid #d0d0d0; border-radius: 12px;
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
  .history { display: flex; gap: 4px; margin-top: 8px; }
  .actions {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    margin-top: 12px;
  }
  .resolve { display: flex; gap: 8px; margin-left: auto; }
  .send { flex-basis: 100%; }
  button.act {
    border-radius: 8px; padding: 6px 10px; cursor: pointer; font: inherit;
    border: 1px solid #d0d0d0; background: #fff; color: #1f1f1f;
  }
  button.small { padding: 2px 8px; font-size: 12px; border-radius: 6px; }
  button.primary {
    background: #1f1f1f; color: #fff; border-color: #1f1f1f;
    padding: 7px 12px; font-weight: 600;
  }
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
  private readonly actions: HTMLDivElement;
  private history: { undo: boolean; redo: boolean } = {
    undo: false,
    redo: false,
  };
  private readonly shape: BadgeShape;
  private anchor: Element | null = null;
  private kind: BadgeState["kind"] = "hidden";
  private resize = new ResizeObserver(() => this.reposition());
  private frame = 0;

  /**
   * Build the badge and wire its buttons.
   *
   * @param actions What to do for each button.
   */
  constructor(
    actions: Record<Action, () => void>,
    site: Site = siteFor(location.hostname),
  ) {
    this.shape = site.badge;
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
            Report this problem to
            <a href="mailto:${HELP_EMAIL}">${HELP_EMAIL}</a>
          </p>
          <div class="history">
            <button class="act small undo" type="button"
              title="Put back the values DataFog replaced.">Undo</button>
            <button class="act small redo" type="button"
              title="Replace the same values again.">Redo</button>
          </div>
          <div class="actions">
            <button class="act dismiss" type="button"
              title="Hide this warning. Send with ${site.name}'s own button.">Dismiss</button>
            <div class="resolve">
              <button class="act primary pseudonymize" type="button"
                title="Replace each value with a marker, keeping the original in your vault so it can be restored.">Pseudonymize</button>
              <button class="act primary redact" type="button"
                title="Replace each value with its type, such as [EMAIL].">Redact</button>
            </div>
            <button class="act send" type="button" hidden>Send anyway</button>
          </div>
        </div>
      </div>`;

    this.wrap = root.querySelector(".wrap")!;
    // Every state keeps the size and shape of the site's own buttons
    this.wrap.style.setProperty("--size", `${this.shape.size}px`);
    this.wrap.style.setProperty("--radius", this.shape.radius);
    this.dot = root.querySelector(".dot")!;
    this.panel = root.querySelector(".panel")!;
    this.title = root.querySelector("h2")!;
    this.list = root.querySelector("ul")!;
    this.files = root.querySelector(".files")!;
    this.paused = root.querySelector(".paused")!;
    this.note = root.querySelector(".note")!;
    this.report = root.querySelector(".report")!;
    this.actions = root.querySelector(".actions")!;

    this.dot.addEventListener("click", () => {
      // Checking dots and the off badge have nothing to show in the panel
      if (this.kind !== "checking" && this.kind !== "off") {
        this.panel.hidden = !this.panel.hidden;
        this.place();
      }
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
      (this.kind === "found" ||
        this.kind === "hidden" ||
        this.kind === "off" ||
        !this.panel.hidden)
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
      this.dot.innerHTML = state.kind === "checking" ? DOTS : MARK;
      if (state.kind === "checking") this.dot.title = "DataFog is checking";
      else if (state.kind === "off") this.dot.title = OFF_TITLE;
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
      if (state.kind === "hidden" || state.kind === "off")
        this.panel.hidden = true;
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
    if (attached)
      this.panel.hidden = this.kind === "hidden" || this.kind === "off";
    else if (warned) this.panel.hidden = true;
    this.place();
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
    this.showActions();
    if (reason !== null) this.panel.hidden = false;
    this.place();
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
    this.actions.hidden = !found && this.buttons.send.hidden;
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
    const { size, centerInset } = this.shape;
    const beside = fromRight >= GAP + size + TAB_ROOM;
    this.wrap.style.right = `${beside ? fromRight - GAP - size : fromRight + GAP}px`;
    this.wrap.style.bottom = `${
      beside
        ? fromBottom + centerInset - size / 2
        : Math.min(
            window.innerHeight - box.top + GAP,
            window.innerHeight - size - GAP,
          )
    }px`;
    this.placePanel();
  }

  /** Keep the popup on screen without moving the badge away from the editor. */
  private placePanel(): void {
    if (this.panel.hidden || this.wrap.hidden) return;
    const dot = this.dot.getBoundingClientRect();
    const above = dot.top - GAP * 2;
    const below = window.innerHeight - dot.bottom - GAP * 2;
    this.panel.style.maxHeight = `${Math.max(0, above, below)}px`;
    const { width, height } = this.panel.getBoundingClientRect();
    this.panel.style.left = `${Math.max(
      GAP,
      Math.min(dot.right - width, window.innerWidth - width - GAP),
    )}px`;
    const top = dot.top - GAP - height;
    this.panel.style.top = `${top >= GAP ? top : dot.bottom + GAP}px`;
  }
}
