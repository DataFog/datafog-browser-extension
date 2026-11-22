import { SITE_NAMES } from "./site";

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

/** Prefer an already-open supported tool, exposing only its public home page. */
export function welcomeTarget(
  tabs: { url?: string; active?: boolean; lastAccessed?: number }[],
): { name: string; url: string } {
  const candidates = tabs.flatMap((tab) => {
    try {
      const url = new URL(tab.url ?? "");
      const site = SITE_NAMES.find(
        (candidate) => candidate.host === url.hostname,
      );
      return site && url.protocol === "https:" ? [{ ...tab, site }] : [];
    } catch {
      return [];
    }
  });
  candidates.sort(
    (a, b) =>
      Number(Boolean(b.active)) - Number(Boolean(a.active)) ||
      (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
  );
  const site = candidates[0]?.site ?? SITE_NAMES[0];
  return { name: site.name, url: `https://${site.host}/` };
}
