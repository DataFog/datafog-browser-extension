/**
 * The first-run flow's state, shared by the service worker and the welcome
 * page. The service worker opens the welcome page once, on a new install.
 *
 *   pin ──► [reload] ──► done
 *
 * Reload appears only when a chat tab open at install couldn't be reached.
 * Every step can be skipped, and nothing reopens the page later.
 */

export type WelcomeStep = "pin" | "reload" | "done";

/** Local storage: chat tabs the service worker couldn't reach at install. */
export const UNREACHED_TABS = "unreachedTabs";

/** Local storage: set once the welcome flow is finished or closed. */
export const ONBOARDED = "onboarded";

/**
 * The steps to show, in order, for what this install needs.
 *
 * @param needs What applies.
 * @returns The steps.
 */
export function welcomeSteps(needs: { reload: boolean }): WelcomeStep[] {
  return needs.reload ? ["pin", "reload", "done"] : ["pin", "done"];
}
