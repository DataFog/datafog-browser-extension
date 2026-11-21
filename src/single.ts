/**
 * One live copy of the content script per page.
 *
 * Chrome runs the content script on pages that load after install, and the
 * service worker also injects it into chat tabs that were already open, at
 * install and after each update. So a page can get a second copy: a duplicate
 * from that injection racing the page's own load, or a fresh copy beside an
 * orphaned one from before an update.
 *
 * A starting copy asks, with a DOM event, whether another copy is here. A
 * live copy answers and the newcomer stops; an orphaned copy, whose
 * extension context is gone, retires instead and lets the newcomer run.
 * The page could fake these events, but the chat site already controls its
 * own page, including whether our circle shows at all.
 */

const HELLO = "datafog-content-hello";
const HERE = "datafog-content-here";

let retired = false;
const retirements: (() => void)[] = [];

/** Whether this copy's extension context still works. */
function live(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

/**
 * Claim the page for this copy, unless a live copy already has it.
 *
 * @returns True if this copy should run.
 */
export function claimPage(): boolean {
  let answered = false;
  const here = () => (answered = true);
  document.addEventListener(HERE, here);
  document.dispatchEvent(new Event(HELLO));
  document.removeEventListener(HERE, here);
  if (answered) return false;
  document.addEventListener(HELLO, () => {
    if (retired) return;
    if (live()) document.dispatchEvent(new Event(HERE));
    else retire();
  });
  return true;
}

/** Stop this copy: it no longer blocks sends or shows anything. */
function retire(): void {
  retired = true;
  for (const undo of retirements) {
    try {
      undo();
    } catch {
      // Best effort: an orphaned copy can't do much
    }
  }
}

/**
 * Run something when this copy retires.
 *
 * @param undo What to take down.
 */
export function onRetire(undo: () => void): void {
  retirements.push(undo);
}

/** Whether this copy has handed the page to a newer one. */
export function isRetired(): boolean {
  return retired;
}
