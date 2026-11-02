/**
 * Side panel: where the vault, workspace and restore views will live.
 */

document
  .querySelector<HTMLButtonElement>("#settings")!
  .addEventListener("click", () => chrome.runtime.openOptionsPage());
