/**
 * The inline badge in the chat box, and its expandable panel.
 *
 * Like Grammarly's: a DataFog badge just outside the chat box, sized and
 * rounded to match it, that turns into a red count when
 * something sensitive is found. Lives in a
 * shadow root so the site's styles can't reach it and its styles can't leak
 * into the page. Shows types and counts only, never values.
 */

import { icon, iconLabel, SR_ONLY } from "./icons";
import { MARK } from "./logo";
import { LABELS } from "./settings";
import { siteFor, type BadgeShape, type Site } from "./site";
import { followTheme } from "./theme";
import { HOST_TOKENS } from "./tokens";

const HELP_EMAIL = "help@datafog.ai";

/** Why the badge is greyed out, on hover. */
export const OFF_TITLE = "datafog is off for this site in settings";

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
const TAB_ROOM = 0;

const STYLE = `
  ${HOST_TOKENS}
  :host { all: initial; }
  ${SR_ONLY}
  .wrap {
    position: fixed; z-index: 2147483647; display: flex;
    flex-direction: column-reverse; align-items: flex-end; gap: 8px;
    pointer-events: none;
    font: 13px/1.45 var(--df-sans); color: var(--df-text);
  }
  .dot {
    box-sizing: border-box; flex: none; width: var(--size);
    height: var(--size); padding: 0; border: 1px solid var(--df-circle-border); border-radius: var(--radius);
    display: grid; place-items: center; cursor: pointer;
    background: #1A2226; color: #fff; font-family: inherit;
    /* The logo, dots and count grow with the badge, up to a 48px badge's */
    --inner: min(var(--size), 48px);
    font-size: calc(var(--inner) * 0.4); font-weight: 600; line-height: 1;
    font-variant-numeric: tabular-nums;
    transition: background-color 140ms ease-out, color 140ms ease-out, border-color 140ms ease-out, box-shadow 140ms ease-out, opacity 140ms ease-out;
  }
  .dot, .panel, .paste-toast { pointer-events: auto; }
  .dot:focus-visible { outline: 2px solid var(--df-focus); outline-offset: 2px; }
  .dot svg { display: block; width: calc(var(--inner) * 0.55); height: auto; }
  .dots {
    display: flex; gap: calc(var(--inner) * 0.08); align-items: center;
  }
  .dots i {
    width: calc(var(--inner) * 0.14); height: calc(var(--inner) * 0.14);
    border-radius: 50%; background: #A7B2B1;
    animation: pulse 1s ease-in-out infinite;
  }
  .dots i:nth-child(2) { animation-delay: 150ms; }
  .dots i:nth-child(3) { animation-delay: 300ms; }
  /* Found: the brand's catch color. No glow: the brand has none. */
  .dot.found { background: #C0362C; }
  .dot.off { filter: grayscale(1); opacity: 0.4; cursor: default; }
  .dot { position: relative; }
  .dot .mark, .dot .count { display: grid; place-items: center; }
  /* Passed: a small check on the mark, so clean differs from idle */
  .dot .ok {
    position: absolute; right: 2px; bottom: 2px; display: grid;
    place-items: center; width: calc(var(--inner) * 0.32);
    height: calc(var(--inner) * 0.32); border-radius: 50%;
    background: #EEF0EF; color: #1E7B34; box-shadow: 0 0 0 2px #1A2226;
  }
  .dot .ok svg { width: 70%; height: 70%; stroke-width: 3; }
  /* First check: the mark, then dots if it takes a moment */
  .dot.checking { position: relative; }
  .dot.checking .dots {
    position: absolute; opacity: 0; animation: show 0s 300ms forwards;
  }
  .dot.checking:not([data-previous]) .mark {
    animation: hide 0s 300ms forwards;
  }
  /* Re-check: the last result stays, with a quiet ring */
  .dot.checking[data-previous] .dots { display: none; }
  .dot.checking[data-previous="found"] { background: #C0362C; }
  .dot.checking[data-previous]::after {
    content: ""; position: absolute; inset: -3px; border-radius: inherit;
    box-shadow: 0 0 0 2px #A7B2B1; opacity: 0.45; animation: halo-in 140ms ease-out;
  }
  @keyframes show { to { opacity: 1; } }
  @keyframes hide { to { opacity: 0; } }
  @keyframes halo-in { from { opacity: 0; } to { opacity: 0.45; } }
  @keyframes popup-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes toast-in { from { opacity: 0; } to { opacity: 1; } }
  /* Failed differs from found by shape and lightness, not hue alone */
  .dot.failed {
    background: #1A2226; color: #FF7A1A; box-shadow: inset 0 0 0 2px #FF7A1A;
  }
  @keyframes pulse { 50% { opacity: 0.3; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .dots i, .spin, .dot.checking[data-previous]::after { animation: none; }
  }
  .tooltip {
    position: absolute; bottom: calc(100% + 8px); right: 0; width: max-content;
    max-width: 230px; padding: 6px 10px; background: #0E1316; color: #EEF0EF;
    border-radius: 8px; font: 12px/1.4 var(--df-sans);
  }
  .panel {
    position: fixed; box-sizing: border-box;
    width: min(560px, calc(100vw - 16px)); overflow: auto;
    border: 1px solid var(--df-line); border-radius: var(--df-radius-panel);
    background: var(--df-surface); color: var(--df-text); padding: 12px;
  }
  .panel:not([hidden]) { animation: popup-in 140ms ease-out; }
  .head { display: flex; align-items: center; gap: 4px; margin: 0 0 8px; }
  .head h2 {
    flex: 1; margin: 0; font-size: 14px; font-weight: 600;
    letter-spacing: -0.01em;
  }
  .local { display: inline-grid; place-items: center; width: 28px; height: 28px; color: var(--df-muted); }
  .history { display: flex; gap: 2px; }
  .panel ul { margin: 0 0 8px; padding: 0; list-style: none; }
  .counts li { color: var(--df-muted); font-size: 12px; }
  .preview-head { position: relative; display: flex; justify-content: flex-end; }
  .mode-tooltip { display: none; position: absolute; right: 0; top: 100%; z-index: 2; max-width: 270px; padding: 8px 10px; border-radius: 8px; background: var(--df-text); color: var(--df-surface); font-size: 11px; box-shadow: 0 4px 16px #0002; }
  .mode-tooltip p { margin: 0; }
  .mode-tooltip p + p { margin-top: 6px; }
  .mode-help:hover + .mode-tooltip, .mode-help:focus + .mode-tooltip { display: block; }
  .modes { grid-column: 3; grid-row: 2; display: flex; justify-self: end; gap: 2px; padding: 2px; border: 1px solid var(--df-line); border-radius: 8px; }
  .mode { padding: 3px 8px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--df-muted); font: inherit; font-size: 11px; cursor: pointer; }
  .mode[aria-pressed="true"] { background: var(--df-hover); color: var(--df-text); border-color: var(--df-muted); font-weight: 600; }
  .mode:focus-visible { outline: 2px solid var(--df-focus); }
  .mode:disabled { opacity: .5; cursor: default; }
  .preview li {
    display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 2px 8px;
    align-items: center; padding: 6px 0; border-top: 1px solid var(--df-line);
  }
  .preview .choose { grid-column:1; grid-row:1 / 3; width:24px; height:24px; padding:3px; border:1px solid var(--df-line); border-radius:999px; background:transparent; color:var(--df-accent-text); cursor:pointer; }
  .preview .choose[aria-checked="false"] svg { visibility:hidden; }
  .preview .choose:focus-visible { outline:2px solid var(--df-focus); outline-offset:2px; }
  .preview li:first-child { border-top: 0; }
  .preview .type {
    grid-column: 2 / -1; grid-row: 1; color: var(--df-muted);
    font: 10px/1.2 var(--df-mono); text-transform: uppercase; letter-spacing: 0.08em;
  }
  .value-pair { grid-column: 2; grid-row: 2; display: flex; align-items: center; gap: 8px; min-width: 0; }
  .preview .original {
    flex: 0 1 auto; max-width: 55%;
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--df-text); font-weight: 500;
  }
  .preview .to { flex: 0 1 auto; display: flex; align-items: center; gap: 6px; min-width: 0; }
  .preview .kept-token { padding: 2px 8px; border: 1px dashed var(--df-line); border-radius: 999px; color: var(--df-muted); font: 11px/1.4 system-ui, sans-serif; }
  .preview [data-kept="true"] .original, .preview [data-kept="true"] .type { opacity: 0.65; }
  .preview .to svg { flex: none; color: var(--df-muted); opacity: .65; }
  .token {
    display: inline-block; min-width: 0; max-width: 150px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; padding: 1px 8px;
    border-radius: var(--df-radius-pill); background: var(--df-token-bg);
    color: var(--df-token-text); font: 11px/1.5 var(--df-mono);
  }
  .note, .progress { margin: 0; color: var(--df-muted); font-size: 12px; }
  .note:empty, .progress:empty { display: none; }
  .files, .paused {
    display: flex; gap: 6px; align-items: flex-start;
    margin: 0 0 8px; color: var(--df-accent-text); font-size: 12px; font-weight: 600;
  }
  .files svg { flex: none; margin-top: 1px; }
  .report { margin: 8px 0 0; color: var(--df-muted); font-size: 12px; }
  .report a { color: inherit; }
  .actions {
    position: relative; display: flex; flex-wrap: wrap; align-items: center;
    gap: 8px; margin-top: 12px;
  }
  .resolve { display: flex; gap: 6px; margin-left: auto; }
  .send { flex-basis: 100%; }
  button.act {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-height: 32px; border-radius: var(--df-radius-pill); padding: 0 12px;
    cursor: pointer; font: inherit; font-weight: 500;
    border: 1px solid var(--df-line); background: transparent; color: var(--df-text);
  }
  button.act:hover:not(:disabled) { background: var(--df-hover); }
  button.act:focus-visible { outline: 2px solid var(--df-focus); outline-offset: 2px; }
  button.icon { width: 32px; padding: 0; border-color: transparent; color: var(--df-muted); }
  button.icon:hover:not(:disabled), button.icon[aria-expanded="true"] { color: var(--df-text); }
  button.primary {
    background: var(--df-primary); color: var(--df-primary-text); border-color: var(--df-primary);
  }
  button.act.primary:hover:not(:disabled), button.act.primary:focus-visible {
    background: var(--df-primary); color: var(--df-primary-text); border-color: var(--df-primary);
    box-shadow: 0 0 0 2px var(--df-line);
  }
  button.act.primary:disabled { opacity: 1; background: var(--df-hover); color: var(--df-muted); border-color: var(--df-line); }
  @media (max-width: 480px) {
    .value-pair { grid-column: 2 / -1; }
    .modes { grid-column: 2 / -1; grid-row: 3; justify-self: start; }
  }
  button.act:disabled { opacity: 0.4; cursor: default; }
  /* In flow under the actions, so it never covers Undo or the findings */
  .paste-toast { padding: 8px 12px; border: 1px solid var(--df-line); border-radius: 999px; background: var(--df-surface); color: var(--df-text); }
  .paste-toast:not([hidden]) { animation: toast-in 140ms ease-out; }
  .paste-toast button { border:0; background:transparent; color:inherit; font:inherit; text-decoration:underline; cursor:pointer; }
  .spin { animation: spin 1s linear infinite; }
  @media (prefers-reduced-motion: reduce) {
    .dot { transition: none; }
    .panel:not([hidden]), .paste-toast:not([hidden]), .dots i, .spin,
    .dot.checking .dots, .dot.checking:not([data-previous]) .mark,
    .dot.checking[data-previous]::after { animation: none; }
  }
  [hidden] { display: none !important; }
`;

const ACTIONS = ["pseudonymize", "undo", "redo", "send"] as const;
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

export type CircleSurface = "circle" | "tooltip" | "popup";

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
  /** The last state that wasn't a check in progress. */
  private settled: BadgeState["kind"] = "hidden";
  /** The last count shown, so a rise can be pointed out. */
  private total = 0;
  private resize = new ResizeObserver(() => this.reposition());
  private frame = 0;
  private busy = false;
  private readonly toast: HTMLDivElement;
  private readonly previewList: HTMLUListElement;
  private readonly progress: HTMLParagraphElement;
  private choiceFocus = -1;
  private modeFocus: "replace" | "redact" | null = null;
  private readonly mode:
    ((index: number, mode: "replace" | "redact") => void) | undefined;
  private readonly choose: ((index: number) => void) | undefined;

  /**
   * Build the badge and wire its buttons.
   *
   * @param actions What to do for each button.
   */
  constructor(
    actions: Record<Action, () => void> & {
      retry?: () => void;
      choose?: (index: number) => void;
      mode?: (index: number, mode: "replace" | "redact") => void;
    },
    site: Site = siteFor(location.hostname),
  ) {
    this.choose = actions.choose;
    this.mode = actions.mode;
    this.shape = site.badge;
    const root = this.host.attachShadow({ mode: "closed" });
    followTheme(this.host);
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="wrap" hidden>
        <button class="dot" type="button" aria-describedby="checking-status"></button><div class="tooltip" id="checking-status" role="tooltip" hidden></div>
        <div class="panel" role="dialog" aria-label="Current draft" hidden>
          <div class="head">
            <h2></h2>
            <div class="history">
              <button class="act icon undo" type="button"
                title="Undo: put back the values datafog masked">${iconLabel("undo", "Undo")}</button>
              <button class="act icon redo" type="button"
                title="Redo: mask the same values again">${iconLabel("redo", "Redo")}</button>
            </div>
            <button class="act icon close" type="button" title="Close">${iconLabel("remove", "Close")}</button>
          </div>
          <p class="files" hidden title="datafog only checks text in the chat box.">${icon("attachment", 14)}<span>Attached files aren't protected.</span></p>
          <p class="paused" hidden></p>
          <ul class="counts"></ul>
          <div class="preview-head"><button class="act icon mode-help" type="button" aria-label="About Mask and Reversible mask" aria-describedby="mode-tooltip">${icon("info", 14)}</button><div class="mode-tooltip" id="mode-tooltip" role="tooltip"><p>Mask hides details for good, without saving originals.</p><p>Reversible mask saves originals so you can restore them later.</p></div></div><ul class="preview"></ul><p class="progress" role="status"></p><p class="note"></p>
          <p class="report" hidden>
            Report this problem to
            <a href="mailto:${HELP_EMAIL}">${HELP_EMAIL}</a>
          </p>
          <div class="actions">
            <button class="act primary pseudonymize" type="button">Apply</button>
            <button class="act retry" type="button" hidden>${icon("retry", 14)}Retry checking</button>
            <button class="act send" type="button" hidden>Send anyway</button>
          </div>
        </div>
      </div>`;

    this.wrap = root.querySelector(".wrap")!;
    this.applyShape();
    this.dot = root.querySelector(".dot")!;
    this.panel = root.querySelector(".panel")!;
    this.title = root.querySelector("h2")!;
    this.list = root.querySelector(".counts")!;
    this.files = root.querySelector(".files")!;
    this.paused = root.querySelector(".paused")!;
    this.note = root.querySelector(".note")!;
    this.report = root.querySelector(".report")!;
    this.actions = root.querySelector(".actions")!;
    this.toast = document.createElement("div");
    this.toast.className = "paste-toast";
    this.toast.setAttribute("role", "status");
    this.toast.hidden = true;
    const toastText = document.createElement("span");
    const toastUndo = document.createElement("button");
    toastUndo.type = "button";
    toastUndo.className = "toast-undo";
    toastUndo.textContent = "Undo";
    toastUndo.addEventListener("click", () => {
      this.toast.hidden = true;
      actions.undo();
    });
    this.toast.append(toastText, toastUndo);
    this.wrap.append(this.toast);
    this.previewList = root.querySelector(".preview")!;
    this.progress = root.querySelector(".progress")!;
    const tooltip = root.querySelector<HTMLElement>(".tooltip")!;
    const showTooltip = () => {
      tooltip.textContent = this.dot.title;
      tooltip.hidden = !this.panel.hidden;
    };
    this.dot.addEventListener("mouseenter", showTooltip);
    this.dot.addEventListener("focus", showTooltip);
    this.dot.addEventListener("mouseleave", () => {
      tooltip.hidden = true;
    });
    this.dot.addEventListener("blur", () => {
      tooltip.hidden = true;
    });
    this.dot.setAttribute("aria-haspopup", "dialog");
    this.dot.setAttribute("aria-expanded", "false");
    root.querySelector(".close")!.addEventListener("click", () => {
      this.close();
      this.dot.focus();
    });
    root
      .querySelector(".retry")!
      .addEventListener("click", () => actions.retry?.());
    root.addEventListener("keydown", (event) => {
      if (
        event instanceof KeyboardEvent &&
        event.key === "Escape" &&
        !event.isComposing
      ) {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        this.dot.focus();
      }
    });

    root.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      const target = event.target;
      if (
        event.key === "Enter" &&
        (event.repeat || event.isComposing) &&
        target instanceof HTMLButtonElement
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        target instanceof HTMLElement &&
        target !== this.buttons.pseudonymize &&
        target.closest(
          "button, input, textarea, select, [contenteditable=true]",
        )
      )
        return;
      if (this.keyboard(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    this.dot.addEventListener("click", () => {
      tooltip.hidden = true;
      if (this.surface === "popup") this.close();
      else this.openPopup();
      this.place();
      // Start on the recommended action, so Enter replaces
      if (!this.panel.hidden)
        (
          this.panel.querySelector<HTMLButtonElement>(
            ".pseudonymize:not([hidden]):not(:disabled)",
          ) ??
          this.panel.querySelector<HTMLButtonElement>(
            "button:not([hidden]):not(:disabled)",
          )
        )?.focus();
    });
    this.buttons = {
      pseudonymize: root.querySelector(".pseudonymize")!,
      undo: root.querySelector(".undo")!,
      redo: root.querySelector(".redo")!,
      send: root.querySelector(".send")!,
    };
    for (const action of ACTIONS) {
      this.buttons[action].addEventListener("click", () => {
        // Undo and Redo can be repeated; the others resolve the warning
        if (action === "send") this.close();
        actions[action]();
      });
    }

    // Close the panel on a click anywhere else, as Grammarly does
    document.addEventListener("pointerdown", (event) => {
      if (!event.composedPath().includes(this.host)) this.close();
    });
    window.addEventListener("resize", () => this.reposition());
    window.addEventListener("scroll", () => this.reposition(), true);
    document.documentElement.append(this.host);
  }

  /** Remove the circle and popup for good, for a retired copy. */
  destroy(): void {
    this.resize.disconnect();
    this.host.remove();
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
    // A re-check keeps the last result in view instead of flashing dots
    const previous: BadgeState["kind"] =
      state.kind === "checking" && this.kind === "checking"
        ? this.settled
        : this.kind;
    const recheck =
      state.kind === "checking" &&
      (previous === "found" || previous === "clean");
    this.settled = state.kind === "checking" ? previous : state.kind;
    this.kind = state.kind;
    this.wrap.hidden = state.kind === "hidden";
    this.dot.className = `dot ${state.kind}`;
    if (recheck) this.dot.dataset.previous = previous;
    else delete this.dot.dataset.previous;

    if (state.kind === "found") {
      const total = Object.values(state.counts).reduce(
        (sum, count) => sum + count,
        0,
      );
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = total > 99 ? "99+" : String(total);
      this.dot.replaceChildren(count);
      if (total > this.total) this.bump();
      this.total = total;
      this.dot.title = `${total} found · click to review`;
      this.title.textContent = `${items(total)} found`;
      this.listCounts(state.counts);
    } else if (state.kind === "failed") {
      // Say so rather than look like a check still running
      const updated = state.code === "extension_reloaded";
      const action = state.action || state.counts ? "mask" : "check";
      const title = updated
        ? "datafog was updated"
        : `datafog couldn't ${action} this text`;
      this.dot.textContent = "!";
      this.dot.title = `${title} · click for details`;
      this.title.textContent = title;
      this.listCounts(state.counts ?? {});
      this.total = 0;
    } else if (state.kind === "checking") {
      // The last result stays underneath; dots only fade in on a first
      // check that takes a moment (CSS delays them)
      const count =
        previous === "found" ? this.dot.textContent?.match(/^\d+\+?/)?.[0] : "";
      this.dot.innerHTML =
        (count
          ? `<span class="count">${count}</span>`
          : `<span class="mark">${MARK}</span>`) + DOTS;
      this.dot.title = "Checking…";
      // An open popup keeps the last result until the new one lands
      if (!recheck) {
        this.title.textContent = "Checking this chat box…";
        this.list.replaceChildren();
      }
    } else {
      this.dot.innerHTML =
        state.kind === "clean"
          ? `<span class="mark">${MARK}</span><span class="ok">${icon("check", 10)}</span>`
          : MARK;
      if (state.kind === "off") this.dot.title = OFF_TITLE;
      else
        this.dot.title =
          state.kind === "clean" ? "Checked · nothing found" : "datafog";
      this.title.textContent =
        state.kind === "clean" ? "Nothing found" : "Waiting for text";
      this.list.replaceChildren();
      this.total = 0;
      if (state.kind === "hidden" || state.kind === "off") this.close();
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
      // The lock icon in the header says this; no repeated footer copy
      this.note.textContent = "";
    }
    // Reloading fixes an update, so there's nothing to report
    this.report.hidden =
      state.kind !== "failed" || state.code === "extension_reloaded";
    this.syncLists();
    const retry = this.panel.querySelector<HTMLButtonElement>(".retry")!;
    retry.hidden = state.kind !== "failed";
    this.showActions();
    this.dot.setAttribute("aria-label", this.dot.title);
    this.wrap.querySelector<HTMLElement>(".tooltip")!.textContent =
      this.dot.title;
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
    if (attached && this.kind !== "hidden" && this.kind !== "off")
      this.openPopup();
    else if (warned || attached) this.close();
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
    this.buttons.send.hidden = reason === null || this.kind !== "failed";
    this.buttons.send.textContent = "Send as is";
    this.showActions();
    if (reason !== null) this.openPopup();
    this.place();
  }

  /** Keyboard action only for an already-open popup; never the opening send key. */
  keyboard(event: KeyboardEvent): boolean {
    if (
      this.panel.hidden ||
      event.isComposing ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    )
      return false;
    if (event.key === "Escape") {
      this.close();
      return true;
    }
    if (event.key !== "Enter") return false;
    if (event.repeat || this.busy) return true;
    const primary = this.buttons.pseudonymize;
    if (primary.hidden) return false;
    if (primary.disabled) return true;
    primary.click();
    return true;
  }

  replaced(count: number, action = "Masked"): void {
    this.toast.querySelector("span")!.textContent =
      `${action} ${count} ${count === 1 ? "item" : "items"} · `;
    this.toast.hidden = false;
    this.place();
  }

  /**
   * Set which of Undo and Redo the panel offers.
   *
   * @param history Whether each is available.
   */
  offer(history: { undo: boolean; redo: boolean }): void {
    this.history = history;
    if (!history.undo) this.toast.hidden = true;
    this.showActions();
  }

  /** Popup workflow progress belongs to the current draft operation. */
  operation(text: string, busy = false): void {
    this.busy = busy;
    this.progress.textContent = text;
    if (busy && text)
      this.progress.insertAdjacentHTML(
        "afterbegin",
        icon("loading", 12).replace('class="lucide"', 'class="lucide spin"') +
          " ",
      );
    this.showActions();
    this.place();
  }

  /** Values are confined to the extension-owned popup and inserted as text. */
  preview(
    findings: readonly {
      original: string;
      marker: string;
      entityType?: string;
      kept?: boolean;
      action?: "replace" | "redact" | "keep";
    }[],
  ): void {
    const focused = this.previewList.querySelector(":focus");
    const focusIndex = Array.from(
      this.previewList.querySelectorAll(".choose"),
    ).indexOf(focused!);
    this.previewList.replaceChildren(
      ...findings.map(
        ({ original, marker, entityType, kept, action }, index) => {
          const row = document.createElement("li");
          const type = document.createElement("span");
          type.className = "type";
          const entity =
            entityType ?? /^\[\[([A-Z_]+?)_[A-Z0-9]+\]\]$/.exec(marker)?.[1];
          type.textContent = entity ? (LABELS[entity] ?? entity) : "";
          const value = document.createElement("span");
          value.className = "original";
          value.title = original;
          value.textContent = original;
          const to = document.createElement("span");
          to.className = "to";
          to.innerHTML = icon("arrow", 14);
          // Screen readers and copy-paste keep the old "a → b" reading
          to.insertAdjacentHTML("afterbegin", '<span class="sr"> → </span>');
          const token = document.createElement("span");
          token.className = "token";
          token.title = marker;
          token.textContent = marker;
          to.append(token);
          const check = document.createElement("button");
          check.type = "button";
          check.className = "choose";
          check.setAttribute("role", "checkbox");
          check.setAttribute("aria-label", `Include ${original}`);
          check.setAttribute("aria-checked", String(!kept));
          check.innerHTML = icon("check", 14);
          check.addEventListener("click", () => {
            this.choiceFocus = index;
            this.modeFocus = null;
            this.choose?.(index);
          });
          row.dataset.kept = String(Boolean(kept));
          if (kept) {
            const keptToken = document.createElement("span");
            keptToken.className = "kept-token";
            keptToken.textContent = "kept as typed";
            to.replaceChildren(keptToken);
          }
          const modes = document.createElement("div");
          modes.className = "modes";
          modes.setAttribute("role", "group");
          modes.setAttribute("aria-label", `Action for ${original}`);
          for (const mode of ["redact", "replace"] as const) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "mode";
            button.dataset.mode = mode;
            button.textContent =
              mode === "replace" ? "Reversible mask" : "Mask";
            button.setAttribute(
              "aria-pressed",
              String((action ?? "replace") === mode),
            );
            button.disabled = Boolean(kept);
            button.addEventListener("click", () => {
              this.choiceFocus = index;
              this.modeFocus = mode;
              this.mode?.(index, mode);
            });
            modes.append(button);
          }
          const pair = document.createElement("div");
          pair.className = "value-pair";
          pair.append(value, to);
          row.append(check, ...(entity ? [type] : []), pair, modes);
          return row;
        },
      ),
    );
    this.showActions();
    if (focusIndex >= 0)
      this.previewList
        .querySelectorAll<HTMLButtonElement>(".choose")
        .item(focusIndex)
        ?.focus();
    this.syncLists();
    this.place();
  }

  /** Per-type counts only when there are no preview rows saying the same. */
  private syncLists(): void {
    this.previewList.hidden = this.previewList.childElementCount === 0;
    this.panel.querySelector<HTMLElement>(".preview-head")!.hidden =
      this.previewList.hidden;
    this.list.hidden =
      this.list.childElementCount === 0 || !this.previewList.hidden;
  }

  /** The DOM visibility is the sole surface owner; this typed projection adds no duplicate state. */
  get surface(): CircleSurface {
    if (!this.panel.hidden) return "popup";
    return this.wrap.querySelector<HTMLElement>(".tooltip")!.hidden
      ? "circle"
      : "tooltip";
  }

  private openPopup(): void {
    this.panel.hidden = false;
    this.wrap.querySelector<HTMLElement>(".tooltip")!.hidden = true;
    this.dot.setAttribute("aria-expanded", "true");
  }

  close(): void {
    this.panel.hidden = true;
    this.dot.setAttribute("aria-expanded", "false");
  }

  /** Pop the count without resizing the circle's hit target or popup anchor. */
  private bump(): void {
    const count = this.dot.querySelector<HTMLElement>(".count");
    if (
      typeof count?.animate !== "function" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    count.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.06)" },
        { transform: "scale(1)" },
      ],
      { duration: 160, easing: "ease-out" },
    );
  }

  private showActions(): void {
    // During a re-check the last findings' actions stay, but wait
    const rechecking =
      this.kind === "checking" && this.dot.dataset.previous === "found";
    const found = this.kind === "found" || rechecking;
    this.buttons.pseudonymize.hidden = !found;
    const intercepted = !this.paused.hidden;
    this.buttons.send.disabled = this.busy;
    const skipped =
      this.previewList.querySelectorAll('[data-kept="true"]').length;
    const chosen = this.previewList.childElementCount - skipped;
    this.buttons.pseudonymize.textContent = intercepted
      ? chosen === 0 && skipped > 0
        ? "Send as is"
        : "Apply & send"
      : "Apply";
    for (const control of this.previewList.querySelectorAll<HTMLButtonElement>(
      ".choose, .mode",
    ))
      control.disabled =
        this.busy ||
        rechecking ||
        (control.classList.contains("mode") &&
          control.closest("li")?.dataset.kept === "true");
    this.actions.hidden = false;
    this.buttons.pseudonymize.disabled =
      this.busy || rechecking || (skipped > 0 && chosen === 0 && !intercepted);
    this.buttons.undo.hidden = !this.history.undo;
    this.buttons.redo.hidden = !this.history.redo;
    this.buttons.undo.disabled = this.busy || !this.history.undo;
    this.buttons.redo.disabled = this.busy || !this.history.redo;
    if (!this.busy && !rechecking && this.choiceFocus >= 0) {
      this.previewList
        .querySelectorAll<HTMLButtonElement>(
          this.modeFocus ? `.mode[data-mode="${this.modeFocus}"]` : ".choose",
        )
        .item(this.choiceFocus)
        ?.focus();
      this.choiceFocus = -1;
    }
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
    const { size } = this.shape;
    const beside = fromRight >= GAP + size + TAB_ROOM;
    this.wrap.style.right = `${beside ? fromRight - GAP - size : fromRight + GAP}px`;
    this.wrap.style.bottom = `${
      beside
        ? fromBottom
        : Math.min(
            window.innerHeight - box.top + GAP,
            window.innerHeight - size - GAP,
          )
    }px`;
    this.placePanel();
  }

  /** Size and round the badge to its shape, the same in every state. */
  private applyShape(): void {
    this.wrap.style.setProperty("--size", `${this.shape.size}px`);
    this.wrap.style.setProperty("--radius", this.shape.radius);
  }

  /** Keep the popup on screen without moving the badge away from the editor. */
  private placePanel(): void {
    if (this.panel.hidden || this.wrap.hidden) return;
    const dot = this.dot.getBoundingClientRect();
    // The Undo toast occupies the strip above the circle. Keep the fixed
    // popup outside that strip so its controls cannot intercept Undo clicks.
    const anchorTop = this.toast.hidden
      ? dot.top
      : Math.min(dot.top, this.toast.getBoundingClientRect().top);
    const above = anchorTop - GAP * 2;
    const below = window.innerHeight - dot.bottom - GAP * 2;
    this.panel.style.maxHeight = `${Math.max(0, above, below)}px`;
    const { width, height } = this.panel.getBoundingClientRect();
    this.panel.style.left = `${Math.max(
      GAP,
      Math.min(dot.right - width, window.innerWidth - width - GAP),
    )}px`;
    const top = anchorTop - GAP - height;
    this.panel.style.top = `${top >= GAP ? top : dot.bottom + GAP}px`;
  }
}
