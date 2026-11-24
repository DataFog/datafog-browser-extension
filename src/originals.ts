/** Answer-scoped local display. Provider-owned nodes and marker text are never edited. */
import type {
  ErrorResponse,
  RestoredValue,
  RestoredWithValues,
} from "./messages";
import { icon, iconLabel, SR_ONLY, type IconName } from "./icons";
import type { Site } from "./site";
import { followTheme, unfollowTheme } from "./theme";
import { HOST_TOKENS } from "./tokens";

const CONTROL_ICONS: Record<string, IconName> = {
  "Show originals": "show",
  "Show placeholders": "hide",
  "Reading originals…": "loading",
  "Retry originals": "retry",
};

/** An icon-only toggle; its label stays its accessible name and tooltip. */
function label(button: HTMLButtonElement, text: keyof typeof CONTROL_ICONS) {
  button.innerHTML = iconLabel(CONTROL_ICONS[text], text, 16);
  if (text === "Reading originals…")
    button.firstElementChild?.classList.add("spin");
  button.title = text;
  button.setAttribute("aria-pressed", String(text === "Show placeholders"));
}

/** A partial or failed result: an alert icon, its words for screen readers. */
function notice(note: HTMLElement, text: string) {
  note.title = text.trim();
  note.innerHTML = text
    ? `${icon("alert", 14)}<span class="sr">${text.replace(/[&<>]/g, "")}</span>`
    : "";
}

export const MARKER = /\[\[[A-Z0-9_]+\]\]/;
interface Reveal {
  host: HTMLElement;
  visibility: string;
  priority: string;
  minHeight: string;
  heightPriority: string;
  resize: ResizeObserver;
  values: readonly RestoredValue[];
  appearance: string;
}
const reveals = new Map<HTMLElement, Reveal>();

function appearanceOf(answer: HTMLElement): string {
  const style = getComputedStyle(answer);
  return `${style.color}|${style.backgroundColor}|${style.colorScheme}`;
}

/** Refresh only the local presentation when the provider's palette changes. */
function refreshAppearance(answer: HTMLElement, force = false): void {
  const reveal = reveals.get(answer);
  if (!reveal || !providerVisible(answer)) return;
  if (force || appearanceOf(answer) !== reveal.appearance)
    showOriginals(answer, reveal.values, false);
}

/** Copy presentation into an extension-owned closed shadow tree. */
function displayClone(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true);
  if (!(clone instanceof HTMLElement)) throw new Error("display_clone_failed");
  const originals = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  originals.forEach((element, index) => {
    const copy = copies[index];
    const styles = getComputedStyle(element);
    // A display copy must not activate provider handlers or reload remote media.
    for (const attribute of Array.from(copy.attributes))
      copy.removeAttribute(attribute.name);
    for (const property of Array.from(styles)) {
      const value = styles.getPropertyValue(property);
      if (!/url\s*\(/i.test(value)) copy.style.setProperty(property, value);
    }
    copy.style.pointerEvents = "none";
  });
  for (const active of clone.querySelectorAll(
    "script, style, link, meta, iframe, object, embed, source",
  ))
    active.remove();
  clone.style.position = "static";
  clone.style.margin = "0";
  clone.style.width = "100%";
  clone.style.height = "auto";
  clone.style.visibility = "visible";
  return clone;
}

function position(answer: HTMLElement, host: HTMLElement): void {
  const box = answer.getBoundingClientRect();
  host.style.left = `${box.left}px`;
  host.style.top = `${box.top}px`;
  host.style.width = `${box.width}px`;
}

/** Reveal all known occurrences in one answer; other answers stay independent. */
export function showOriginals(
  answer: Element,
  restored: readonly RestoredValue[],
  animate = true,
): number {
  if (!(answer instanceof HTMLElement)) return 0;
  hideOriginals(answer);
  const values = new Map(restored.map((item) => [item.marker, item.original]));
  const clone = displayClone(answer);
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const nodes: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    nodes.push(node);
  let shown = 0;
  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(new RegExp(MARKER, "g"))) {
      const original = values.get(match[0]);
      if (original === undefined) continue;
      fragment.append(text.slice(last, match.index));
      const value = document.createElement("span");
      value.className = animate ? "restored-value revealing" : "restored-value";
      value.textContent = original;
      value.title = `Local original for ${match[0]}`;
      value.setAttribute("aria-description", value.title);
      value.tabIndex = 0;
      value.style.cssText =
        "pointer-events:auto;text-decoration:underline dotted;text-underline-offset:3px;background:color-mix(in srgb,#C0362C 7%,transparent);border-radius:2px;cursor:help;";
      fragment.append(value);
      last = match.index + match[0].length;
      shown++;
    }
    if (last) {
      fragment.append(text.slice(last));
      node.parentNode?.replaceChild(fragment, node);
    }
  }
  if (!shown) return 0;
  const host = document.createElement("datafog-original");
  host.style.cssText =
    "position:fixed;z-index:2147483645;pointer-events:none;display:block;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .restored-value.revealing { animation-name: original-in; animation-duration: 0.14s; animation-timing-function: ease-out; }
    @keyframes original-in { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .restored-value.revealing { animation: none; }
    }
  `;
  root.append(clone, style);
  const resize = new ResizeObserver(() => {
    answer.style.setProperty(
      "min-height",
      `${clone.getBoundingClientRect().height}px`,
      "important",
    );
    position(answer, host);
  });
  reveals.set(answer, {
    host,
    visibility: answer.style.getPropertyValue("visibility"),
    priority: answer.style.getPropertyPriority("visibility"),
    minHeight: answer.style.getPropertyValue("min-height"),
    heightPriority: answer.style.getPropertyPriority("min-height"),
    resize,
    values: restored.map((value) => ({ ...value })),
    appearance: appearanceOf(answer),
  });
  answer.style.setProperty("visibility", "hidden", "important");
  document.documentElement.append(host);
  position(answer, host);
  resize.observe(clone);
  return shown;
}

/** Hide one answer, or clean up every extension-owned reveal. No storage write. */
export function hideOriginals(answer?: Element): void {
  for (const [element, reveal] of reveals) {
    if (answer && element !== answer) continue;
    element.style.setProperty("visibility", reveal.visibility, reveal.priority);
    reveal.resize.disconnect();
    element.style.setProperty(
      "min-height",
      reveal.minHeight,
      reveal.heightPriority,
    );
    reveal.host.remove();
    reveals.delete(element);
  }
}

/** Provider-hidden conversations must not retain an extension-owned reveal. */
function providerVisible(answer: HTMLElement): boolean {
  if (!answer.isConnected) return false;
  for (
    let element: HTMLElement | null = answer;
    element;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    if (element.hidden || style.display === "none" || style.opacity === "0")
      return false;
    // Only our own source visibility mask is excluded from the visibility check.
    if (
      !(element === answer && reveals.has(answer)) &&
      (style.visibility === "hidden" || style.visibility === "collapse")
    )
      return false;
  }
  return true;
}

function reposition(): void {
  for (const [answer, reveal] of reveals) {
    if (!providerVisible(answer)) hideOriginals(answer);
    else position(answer, reveal.host);
  }
}
window.addEventListener("scroll", reposition, true);
window.addEventListener("resize", reposition);
window
  .matchMedia?.("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    for (const answer of Array.from(reveals.keys()))
      refreshAppearance(answer, true);
  });

/** Explicit per-answer read and visibility states. */
type AnswerState = "probing" | "hidden" | "reading" | "shown" | "failed";
interface AnswerControl {
  text: string;
  version: number;
  state: AnswerState;
  host: HTMLElement;
  button: HTMLButtonElement;
  copy: HTMLButtonElement;
  copying: boolean;
  note: HTMLSpanElement;
}

const textOf = (answer: HTMLElement) => answer.textContent ?? "";

/** One control in each answer's action row, invalidated by streaming and redraws. */
export function watchAnswers(
  site: Site,
  read: (text: string) => Promise<RestoredWithValues | ErrorResponse>,
): { dispose: () => void; refresh: () => void } {
  const controls = new Map<HTMLElement, AnswerControl>();
  let stopped = false;
  let scheduled = false;
  const valid = (
    answer: HTMLElement,
    control: AnswerControl,
    version: number,
  ) =>
    !stopped &&
    providerVisible(answer) &&
    controls.get(answer) === control &&
    control.version === version &&
    textOf(answer) === control.text;

  function actionRow(answer: HTMLElement): HTMLElement | null {
    // Current ChatGPT responses nest renderer wrappers deeply inside a turn.
    // Traverse to the provider's turn boundary, never into a neighboring turn.
    const boundary = answer.parentElement?.closest(
      site.answerContainer ?? "article",
    );
    let scope: HTMLElement | null = answer;
    for (let depth = 0; scope; depth++, scope = scope.parentElement) {
      if (!boundary && depth >= 5) break;
      const row = scope.querySelector<HTMLElement>(
        site.answerActions ?? "[data-actions], [role='toolbar']",
      );
      if (row) return row;
      if (scope === boundary) break;
      if (
        scope.parentElement?.querySelectorAll(site.answers.join(",")).length &&
        scope.parentElement.querySelectorAll(site.answers.join(",")).length > 1
      )
        break;
    }
    return null;
  }

  async function probe(
    answer: HTMLElement,
    control: AnswerControl,
  ): Promise<void> {
    const version = control.version;
    const response = await read(control.text);
    if (!valid(answer, control, version)) return;
    if ("error" in response) {
      control.state = "failed";
      control.host.hidden = true;
      return;
    }
    control.state = "hidden";
    control.host.hidden = response.values.length === 0;
    notice(
      control.note,
      response.unrestored ? " Some placeholders are unavailable." : "",
    );
  }

  async function toggle(
    answer: HTMLElement,
    control: AnswerControl,
  ): Promise<void> {
    if (control.state === "reading") return;
    if (control.state === "shown") {
      hideOriginals(answer);
      control.state = "hidden";
      label(control.button, "Show originals");
      return;
    }
    control.state = "reading";
    control.button.disabled = true;
    label(control.button, "Reading originals…");
    const version = control.version;
    const response = await read(control.text);
    if (!valid(answer, control, version)) return;
    control.button.disabled = false;
    if ("error" in response) {
      control.state = "failed";
      label(control.button, "Retry originals");
      notice(
        control.note,
        " Originals unavailable. Placeholders are unchanged.",
      );
      return;
    }
    const shown = showOriginals(answer, response.values);
    control.state = shown ? "shown" : "hidden";
    label(control.button, shown ? "Show placeholders" : "Show originals");
    control.host.hidden = shown === 0;
    notice(
      control.note,
      response.unrestored ? " Some placeholders could not be restored." : "",
    );
  }

  async function copyOriginals(
    answer: HTMLElement,
    control: AnswerControl,
  ): Promise<void> {
    if (control.copying) return;
    control.copying = true;
    control.copy.disabled = true;
    const version = control.version;
    notice(control.note, "Reading originals for copy…");
    try {
      const response = await read(control.text);
      if (!valid(answer, control, version)) return;
      if ("error" in response) {
        notice(
          control.note,
          "Originals unavailable. Nothing was copied. Try again.",
        );
        return;
      }
      // Validate immediately before the clipboard write, never after a stale read.
      await navigator.clipboard.writeText(response.text);
      if (valid(answer, control, version))
        notice(
          control.note,
          response.unrestored
            ? "Copied with originals. Placeholders without a saved original stay as they are."
            : "Copied with originals.",
        );
    } catch {
      if (valid(answer, control, version))
        notice(control.note, "Couldn't copy originals. Try again.");
    } finally {
      if (controls.get(answer) === control && version === control.version) {
        control.copying = false;
        control.copy.disabled = false;
      }
    }
  }

  function update(): void {
    scheduled = false;
    if (stopped) return;
    const answers = new Set<HTMLElement>();
    for (const selector of site.answers) {
      for (const answer of document.querySelectorAll<HTMLElement>(selector))
        if (providerVisible(answer)) answers.add(answer);
      if (answers.size) break;
    }
    for (const [answer, control] of controls) {
      if (answers.has(answer) && answer.isConnected) continue;
      hideOriginals(answer);
      control.host.remove();
      unfollowTheme(control.host);
      controls.delete(answer);
    }
    for (const answer of answers) {
      const text = textOf(answer);
      let control = controls.get(answer);
      if (!MARKER.test(text)) {
        if (control) {
          hideOriginals(answer);
          control.host.remove();
          unfollowTheme(control.host);
          controls.delete(answer);
        }
        continue;
      }
      const row = actionRow(answer);
      if (!row) continue;
      if (!control) {
        const host = document.createElement("datafog-answer-control");
        host.hidden = true;
        const root = host.attachShadow({ mode: "closed" });
        followTheme(host);
        const style = document.createElement("style");
        // Sized and colored to sit among the site's own icon buttons
        style.textContent = `${HOST_TOKENS}
          :host { display:inline-flex; align-items:center; gap:2px; }
          :host([hidden]) { display:none; }
          ${SR_ONLY}
          button { display:inline-grid; place-items:center; width:32px; height:32px; padding:0; border:0; border-radius:8px; background:transparent; color:inherit; opacity:0.75; cursor:pointer; }
          button:hover { opacity:1; background:color-mix(in srgb, currentColor 10%, transparent); }
          button:focus-visible { outline:2px solid var(--df-focus); outline-offset:1px; }
          button[aria-pressed="true"] { opacity:1; color:var(--df-accent-text); }
          button:disabled { cursor:default; }
          .copy-originals { display:inline-flex; gap:5px; width:auto; padding:0 6px; font:12px var(--df-sans); }
          span[role="status"] { display:inline-grid; place-items:center; color:var(--df-accent-text); }
          .spin { animation: spin 1s linear infinite; }
          @keyframes spin { to { transform: rotate(360deg); } }
          @media (prefers-reduced-motion: reduce) { .spin { animation:none; } }`;
        const button = document.createElement("button");
        button.type = "button";
        label(button, "Show originals");
        const note = document.createElement("span");
        note.setAttribute("role", "status");
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "copy-originals";
        copy.innerHTML = `${icon("copy", 14)}Copy with originals`;
        copy.title =
          "Copy this answer with available originals. The site's Copy keeps placeholders.";
        root.append(style, button, copy, note);
        control = {
          text,
          version: 1,
          state: "probing",
          host,
          button,
          copy,
          copying: false,
          note,
        };
        controls.set(answer, control);
        const current = control;
        button.addEventListener("click", () => void toggle(answer, current));
        copy.addEventListener(
          "click",
          () => void copyOriginals(answer, current),
        );
        row.append(host);
        void probe(answer, control);
      } else {
        if (control.host.parentElement !== row) row.append(control.host);
        if (control.text === text) {
          refreshAppearance(answer);
          continue;
        }
        hideOriginals(answer);
        control.text = text;
        control.version++;
        control.copying = false;
        control.copy.disabled = false;
        control.state = "probing";
        control.host.hidden = true;
        control.button.disabled = false;
        label(control.button, "Show originals");
        void probe(answer, control);
      }
    }
  }
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some(
      (mutation) =>
        mutation.type !== "attributes" ||
        (mutation.target instanceof HTMLElement &&
          !mutation.target.closest(
            "datafog-original, datafog-answer-control, datafog-badge",
          )),
    );
    if (!relevant || scheduled) return;
    scheduled = true;
    queueMicrotask(update);
  });
  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
    subtree: true,
  });
  update();
  return {
    refresh: () => {
      for (const [answer, control] of controls) {
        hideOriginals(answer);
        control.version++;
        control.copying = false;
        control.copy.disabled = false;
        control.state = "probing";
        control.host.hidden = true;
        control.button.disabled = false;
        label(control.button, "Show originals");
        void probe(answer, control);
      }
      update();
    },
    dispose: () => {
      stopped = true;
      observer.disconnect();
      for (const [answer, control] of controls) {
        hideOriginals(answer);
        control.host.remove();
        unfollowTheme(control.host);
      }
      controls.clear();
    },
  };
}
