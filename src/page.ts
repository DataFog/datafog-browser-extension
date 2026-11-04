/**
 * Watches the page for sends and attached files. Listens in the capture phase,
 * ahead of ChatGPT's own handlers, on events rather than ChatGPT's markup,
 * since those survive redesigns.
 */

const SEND_BUTTONS =
  'button[type="submit"], [data-testid="send-button"], #composer-submit-button';

export interface PageEvents {
  /** The user asked to send; one send can report more than once. */
  send: () => void;
  /** The user attached a file. */
  files: () => void;
}

/**
 * Start watching the page.
 *
 * @param findComposer Finds the current chat box.
 * @param events Called as things happen.
 */
export function watchPage(
  findComposer: () => HTMLElement | null,
  events: PageEvents,
): void {
  const inForm = (target: EventTarget | null): boolean => {
    const composer = findComposer();
    return (
      target instanceof Node &&
      Boolean((composer?.closest("form") ?? composer)?.contains(target))
    );
  };

  document.addEventListener(
    "keydown",
    (event) => {
      const newline = event.shiftKey || event.isComposing;
      if (event.key === "Enter" && !newline && inForm(event.target))
        events.send();
    },
    true,
  );
  document.addEventListener(
    "click",
    ({ target }) => {
      const button =
        target instanceof Element ? target.closest(SEND_BUTTONS) : null;
      if (button && inForm(button)) events.send();
    },
    true,
  );
  document.addEventListener(
    "submit",
    ({ target }) => {
      if (inForm(target)) events.send();
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
  // ChatGPT takes a dropped file anywhere on the page
  document.addEventListener(
    "drop",
    ({ dataTransfer }) => {
      if (dataTransfer?.types.includes("Files")) events.files();
    },
    true,
  );
}
