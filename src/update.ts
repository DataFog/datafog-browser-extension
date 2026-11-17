/**
 * A newer DataFog that Chrome has downloaded but not installed. Chrome
 * installs an update once the extension is idle, which the offscreen document
 * can hold off, so a fix can sit waiting until DataFog restarts.
 */

/** Where the service worker saves the waiting version, in local storage. */
export const PENDING_UPDATE = "pendingUpdate";

/**
 * Whether a saved waiting version is newer than the one running. Once it's
 * installed, the saved version is this one, so it no longer counts.
 *
 * @param pending The saved version, if any.
 * @returns True if an update is waiting.
 */
export function isPending(pending: unknown): boolean {
  return (
    typeof pending === "string" &&
    pending !== chrome.runtime.getManifest().version
  );
}

/**
 * Whether an update is waiting. If not, ask Chrome to look for one; it
 * downloads any it finds, and the service worker saves its version then.
 *
 * @returns True if an update is waiting now.
 */
export async function updateWaiting(): Promise<boolean> {
  const saved = await chrome.storage.local.get(PENDING_UPDATE);
  if (isPending(saved[PENDING_UPDATE])) return true;
  // Throttled or offline is fine: Chrome also checks on its own schedule
  chrome.runtime.requestUpdateCheck().catch(() => {});
  return false;
}
