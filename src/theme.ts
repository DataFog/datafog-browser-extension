/**
 * The light or dark theme for every datafog surface: System (follow the
 * browser), Light or Dark, chosen on the settings page.
 *
 * Stored in plain local storage, not the encrypted settings: it's a display
 * choice with nothing sensitive in it, and the circle needs it before the
 * vault has opened. Each surface marks its root with data-theme; theme.css
 * and src/tokens.ts pick the palette from that, falling back to the
 * browser's preference for System.
 */

export type Theme = "system" | "light" | "dark";

/** The local storage key. */
export const THEME_KEY = "theme";

const isTheme = (value: unknown): value is Theme =>
  value === "system" || value === "light" || value === "dark";

let current: Theme = "system";
const targets = new Set<Element>();
let watching = false;

function paint(target: Element): void {
  if (current === "system") target.removeAttribute("data-theme");
  else target.setAttribute("data-theme", current);
}

function set(theme: Theme): void {
  current = theme;
  for (const target of targets) paint(target);
}

/** The storage API, where this context has one (tests may not). */
function storage(): typeof chrome.storage | undefined {
  try {
    return globalThis.chrome?.storage?.local ? chrome.storage : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keep an element's data-theme in step with the chosen theme.
 *
 * @param target The page's root element, or a shadow root's host.
 */
export function followTheme(target: Element): void {
  targets.add(target);
  paint(target);
  if (watching) return;
  watching = true;
  const api = storage();
  if (!api) return;
  void api.local
    .get(THEME_KEY)
    .then((stored) => {
      const value: unknown = stored[THEME_KEY];
      if (isTheme(value)) set(value);
    })
    .catch(() => {});
  api.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(THEME_KEY in changes)) return;
    const value: unknown = changes[THEME_KEY].newValue;
    set(isTheme(value) ? value : "system");
  });
}

/** Stop following, for an element that's gone. */
export function unfollowTheme(target: Element): void {
  targets.delete(target);
}

/** The theme now in effect. */
export function currentTheme(): Theme {
  return current;
}

/**
 * Choose a theme for every surface.
 *
 * @param theme The theme.
 */
export async function saveTheme(theme: Theme): Promise<void> {
  set(theme);
  await storage()?.local.set({ [THEME_KEY]: theme });
}
