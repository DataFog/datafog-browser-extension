/**
 * The inline badge in the chat box, and its expandable panel.
 *
 * Like Grammarly's: a small DataFog logo in the chat box's bottom-right corner
 * that turns into a red count when something sensitive is found. Lives in a
 * shadow root so ChatGPT's styles can't reach it and its styles can't leak
 * into the page. Shows types and counts only, never values.
 */

import { LOGO } from "./logo";
import { LABELS } from "./settings";

export type BadgeState =
  | { kind: "hidden" }
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "clean" }
  | { kind: "failed" }
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
  .dot.checking svg { animation: pulse 1s ease-in-out infinite; }
  .dot.found {
    background: #d93025; color: #fff; font-weight: 700; font-size: 12px;
    box-shadow: 0 1px 4px rgba(217, 48, 37, 0.45);
  }
  .dot.failed {
    background: #b06000; color: #fff; font-weight: 700; font-size: 13px;
    box-shadow: 0 1px 4px rgba(176, 96, 0, 0.45);
  }
  @keyframes pulse { 50% { opacity: 0.4; } }
  .panel {
    width: 280px; border: 1px solid #d0d0d0; border-radius: 12px;
    background: #fff; color: #1f1f1f; padding: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
  }
  .panel h2 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
  .panel ul { margin: 0 0 8px; padding-left: 18px; }
  .note { margin: 0; color: #666; font-size: 12px; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
  button.act {
    border-radius: 8px; padding: 6px 12px; cursor: pointer; font: inherit;
    border: 1px solid #d0d0d0; background: #fff; color: #1f1f1f;
  }
  button.primary { background: #1f1f1f; color: #fff; border-color: #1f1f1f; }
  [hidden] { display: none !important; }
`;

/** The badge's size, and its gap from the chat box's edges, in pixels. */
const DOT_SIZE = 24;
const INSET = 6;

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
  private readonly note: HTMLParagraphElement;
  private readonly actions: HTMLDivElement;
  private anchor: Element | null = null;
  private kind: BadgeState["kind"] = "hidden";
  private resize = new ResizeObserver(() => this.reposition());
  private frame = 0;

  /**
   * Build the badge and wire its buttons.
   *
   * @param onRedact Called when the user chooses Redact.
   * @param onDismiss Called when the user chooses Dismiss.
   */
  constructor(onRedact: () => void, onDismiss: () => void) {
    const root = this.host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="wrap" hidden>
        <button class="dot" type="button"></button>
        <div class="panel" hidden>
          <h2></h2>
          <ul></ul>
          <p class="note"></p>
          <div class="actions">
            <button class="act dismiss" type="button"
              title="Hide this warning. Send with ChatGPT's own button.">Dismiss</button>
            <button class="act primary redact" type="button">Redact</button>
          </div>
        </div>
      </div>`;

    this.wrap = root.querySelector(".wrap")!;
    this.dot = root.querySelector(".dot")!;
    this.panel = root.querySelector(".panel")!;
    this.title = root.querySelector("h2")!;
    this.list = root.querySelector("ul")!;
    this.note = root.querySelector(".note")!;
    this.actions = root.querySelector(".actions")!;

    this.dot.addEventListener("click", () => {
      if (this.kind !== "checking") this.panel.hidden = !this.panel.hidden;
    });
    // Either action resolves the warning, so the panel closes with it
    root.querySelector(".redact")!.addEventListener("click", () => {
      this.panel.hidden = true;
      onRedact();
    });
    root.querySelector(".dismiss")!.addEventListener("click", () => {
      this.panel.hidden = true;
      onDismiss();
    });

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
   * @param anchor The chat box element.
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
    // Keep a red count steady while rechecking, rather than flicker to the logo
    if (state.kind === "checking" && this.kind === "found") return;
    this.kind = state.kind;
    this.wrap.hidden = state.kind === "hidden";
    this.dot.className = `dot ${state.kind}`;

    if (state.kind === "found") {
      const entries = Object.entries(state.counts);
      const total = entries.reduce((sum, [, count]) => sum + count, 0);
      this.dot.textContent = total > 99 ? "99+" : String(total);
      this.dot.title = `DataFog: ${items(total)} found. Click to review.`;
      this.title.textContent = `${items(total)} you may not want to share`;
      this.list.replaceChildren(
        ...entries.map(([type, count]) => {
          const item = document.createElement("li");
          item.textContent = `${LABELS[type] ?? type}: ${count}`;
          return item;
        }),
      );
    } else if (state.kind === "failed") {
      // Say so rather than look like a check still running
      this.dot.textContent = "!";
      this.dot.title = "DataFog couldn't check this text. Click for details.";
      this.title.textContent = "DataFog couldn't check this text";
      this.list.replaceChildren();
    } else {
      this.dot.innerHTML = LOGO;
      this.dot.title =
        state.kind === "clean" ? "DataFog: no sensitive data found" : "DataFog";
      this.title.textContent =
        state.kind === "clean"
          ? "No sensitive data found"
          : "DataFog is checking this chat box";
      this.list.replaceChildren();
      // Nothing flagged, nothing to act on; a stale panel shouldn't linger
      if (state.kind !== "clean" && state.kind !== "idle")
        this.panel.hidden = true;
    }

    this.note.textContent =
      state.kind === "failed"
        ? "Reload the page to try again."
        : "Checked on this device by DataFog. Nothing was sent.";
    this.list.hidden = state.kind !== "found";
    this.actions.hidden = state.kind !== "found";
    this.dot.setAttribute("aria-label", this.dot.title);
    this.place();
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
   * Keep the badge in the bottom-right corner of the part of the chat box
   * that's on screen, so a long prompt scrolled inside the box doesn't carry
   * it out of view. A box too short for the corner, such as a one-line chat
   * box, centers the badge on it instead.
   */
  private place(): void {
    if (!this.anchor) return;
    const box = visibleBox(this.anchor);
    this.wrap.style.visibility = box ? "" : "hidden";
    if (!box) return;
    const height = box.bottom - box.top;
    const bottom =
      height < DOT_SIZE + 2 * INSET ? (height - DOT_SIZE) / 2 : INSET;
    this.wrap.style.right = `${Math.max(8, window.innerWidth - box.right + INSET)}px`;
    this.wrap.style.bottom = `${window.innerHeight - box.bottom + bottom}px`;
  }
}
