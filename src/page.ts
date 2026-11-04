/**
 * Watches the page for sends and attached files. Listens in the capture phase,
 * ahead of ChatGPT's own handlers, on events rather than ChatGPT's markup,
 * since those survive redesigns.
 */

const SEND_BUTTONS =
  'button[type="submit"], [data-testid="send-button"], #composer-submit-button';

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

  const ask = (event: Event, repeat = false): void => {
    if (events.send(repeat)) return;
    // Ahead of ChatGPT's handlers, so they never see the send
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
        target instanceof Element ? target.closest(SEND_BUTTONS) : null;
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
  // ChatGPT takes a dropped file anywhere on the page
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
 */
export function clickSend(composer: HTMLElement): void {
  const form = composer.closest("form");
  const button = form?.querySelector<HTMLButtonElement>(
    `:is(${SEND_BUTTONS}):not(:disabled)`,
  );
  if (button) button.click();
  else form?.requestSubmit();
}
