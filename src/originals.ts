/**
 * Original values shown in place of markers in ChatGPT's answer.
 *
 * Each value sits in a closed shadow root, so it shows on screen while the
 * page's own scripts, its copy button and its text still see only the marker.
 */

import type { RestoredValue } from "./messages";

/** A marker such as [[EMAIL_7KQ4ZM]]. */
export const MARKER = /\[\[[A-Z0-9_]+\]\]/;

const STYLE = `
  :host { all: initial; font: inherit; color: inherit; }
  span {
    font: inherit; color: inherit; border-radius: 3px; padding: 0 2px;
    background: rgba(37, 99, 235, 0.14);
    box-shadow: inset 0 -1px 0 rgba(37, 99, 235, 0.5);
  }
`;

/** A text node swapped for its pieces, so it can be put back. */
interface Swap {
  original: Text;
  pieces: Node[];
}

let swaps: Swap[] = [];

/**
 * Build the element that shows one original value.
 *
 * @param marker The marker it replaces.
 * @param value The original value.
 * @returns The element.
 */
function valueElement(marker: string, value: string): HTMLElement {
  const host = document.createElement("datafog-original");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const span = document.createElement("span");
  // Values only ever go in as text, never as markup
  span.textContent = value;
  span.title = `Restored by DataFog from ${marker}`;
  root.append(style, span);
  return host;
}

/**
 * Split a text node's text into plain runs and known markers.
 *
 * @param text The text.
 * @param values Each marker's original value.
 * @returns The pieces to put in its place, or null if it has no known marker.
 */
function piecesOf(text: string, values: Map<string, string>): Node[] | null {
  const pieces: Node[] = [];
  let at = 0;
  let found = false;
  for (const match of text.matchAll(new RegExp(MARKER, "g"))) {
    const value = values.get(match[0]);
    if (value === undefined) continue;
    if (match.index > at)
      pieces.push(document.createTextNode(text.slice(at, match.index)));
    pieces.push(valueElement(match[0], value));
    at = match.index + match[0].length;
    found = true;
  }
  if (!found) return null;
  if (at < text.length) pieces.push(document.createTextNode(text.slice(at)));
  return pieces;
}

/**
 * Show the original values in place of their markers in an answer, putting
 * back any shown before.
 *
 * @param answer The answer's element.
 * @param restored Each marker and its original value.
 * @returns How many markers now show their value.
 */
export function showOriginals(
  answer: Element,
  restored: readonly RestoredValue[],
): number {
  hideOriginals();
  const values = new Map(restored.map((item) => [item.marker, item.original]));
  const walker = document.createTreeWalker(answer, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node instanceof Text && MARKER.test(node.data)) texts.push(node);
  let shown = 0;
  // Swap after walking, so the walk doesn't see its own changes
  for (const original of texts) {
    const pieces = piecesOf(original.data, values);
    if (!pieces) continue;
    original.replaceWith(...pieces);
    swaps.push({ original, pieces });
    shown += pieces.filter((piece) => piece instanceof HTMLElement).length;
  }
  return shown;
}

/** Put the markers back wherever original values are shown. */
export function hideOriginals(): void {
  for (const { original, pieces } of swaps) {
    // The page may have redrawn the answer since; skip what's gone
    if (!pieces[0]?.parentNode) continue;
    pieces[0].parentNode.insertBefore(original, pieces[0]);
    for (const piece of pieces) piece.parentNode?.removeChild(piece);
  }
  swaps = [];
}
