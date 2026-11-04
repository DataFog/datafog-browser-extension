/**
 * Side panel: where the vault, workspace and restore views will live.
 */

document
  .querySelector<HTMLButtonElement>("#settings")!
  .addEventListener("click", () => chrome.runtime.openOptionsPage());

/** Connect to the service worker, which closes this panel on request. */
export async function connect(): Promise<void> {
  const { id } = await chrome.windows.getCurrent();
  const port = chrome.runtime.connect({ name: String(id) });
  port.onMessage.addListener(() => window.close());
  // Chrome stops an idle service worker; reconnecting restarts it
  port.onDisconnect.addListener(() => void connect());
}

void connect();
