/**
 * Watches the page for sends and attached files. Listens in the capture phase,
 * ahead of the site's own handlers, on events rather than the site's markup,
 * since those survive redesigns.
 */

import { siteFor, type Site } from "./site";

export interface PageEvents {
  /**
   * The user asked to send; one send can report more than once. A key held
   * down reports as a repeat. Returning false stops the send.
   */
  send: (repeat: boolean) => boolean;
  /** The user attached a file. */
  files: () => void;
}

/**
 * Start watching the page.
 *
 * @param findComposer Finds the current chat box.
 * @param events Called as things happen.
 * @param site The chat site.
 */
export function watchPage(
  findComposer: () => HTMLElement | null,
  events: PageEvents,
  site: Site = siteFor(location.hostname),
): void {
  const inForm = (target: EventTarget | null): boolean => {
    const composer = findComposer();
    return (
      target instanceof Node &&
      Boolean((composer?.closest(site.box) ?? composer)?.contains(target))
    );
  };

  const ask = (event: Event, repeat = false): void => {
    if (events.send(repeat)) return;
    // Ahead of the site's handlers, so they never see the send
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  document.addEventListener(
    "keydown",
    (event) => {
      const newline = event.shiftKey || event.isComposing;
      if (event.key === "Enter" && !newline && inForm(event.target))
        ask(event, event.repeat);
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      const { target } = event;
      const button =
        target instanceof Element ? target.closest(site.sendButtons) : null;
      if (button && inForm(button)) ask(event);
    },
    true,
  );
  document.addEventListener(
    "submit",
    (event) => {
      if (inForm(event.target)) ask(event);
    },
    true,
  );

  document.addEventListener(
    "change",
    ({ target }) => {
      if (target instanceof HTMLInputElement && target.type === "file")
        events.files();
    },
    true,
  );
  document.addEventListener(
    "paste",
    ({ clipboardData }) => {
      if (clipboardData?.files.length) events.files();
    },
    true,
  );
  // ChatGPT and Claude take a dropped file anywhere on the page
  document.addEventListener(
    "drop",
    ({ dataTransfer }) => {
      if (dataTransfer?.types.includes("Files")) events.files();
    },
    true,
  );
}

/**
 * Send what's in the chat box, as if the user had pressed the send button.
 *
 * @param composer The chat box.
 * @param site The chat site.
 */
export function clickSend(
  composer: HTMLElement,
  site: Site = siteFor(location.hostname),
): void {
  const box = composer.closest(site.box);
  const button = box?.querySelector<HTMLButtonElement>(
    `:is(${site.sendButtons}):not(:disabled)`,
  );
  if (button) button.click();
  else if (box instanceof HTMLFormElement) box.requestSubmit();
}
