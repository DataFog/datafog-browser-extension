/**
 * Lucide icons for every extension surface.
 *
 * The extension has no framework, so this uses the framework-free `lucide`
 * package (the same icon set as `lucide-react`) and renders each icon's node
 * list to an SVG string. Named imports keep the bundle to the icons used.
 * Icons are decorative: the button that holds one carries its name in a
 * visually hidden label, so the accessible name and tests stay unchanged.
 */

import {
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  Ellipsis,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  Flag,
  Globe,
  Info,
  KeyRound,
  LifeBuoy,
  LoaderCircle,
  Lock,
  PanelRight,
  Play,
  Pause,
  Paperclip,
  Plus,
  Puzzle,
  Redo2,
  RotateCw,
  Search,
  Settings,
  ShieldCheck,
  SunMoon,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
  type IconNode,
} from "lucide";

export const ICONS = {
  arrow: ArrowRight,
  play: Play,
  pause: Pause,
  check: Check,
  copy: Copy,
  alert: CircleAlert,
  more: Ellipsis,
  redact: Eraser,
  external: ExternalLink,
  show: Eye,
  hide: EyeOff,
  flag: Flag,
  globe: Globe,
  info: Info,
  originals: KeyRound,
  support: LifeBuoy,
  loading: LoaderCircle,
  lock: Lock,
  sidebar: PanelRight,
  attachment: Paperclip,
  add: Plus,
  puzzle: Puzzle,
  redo: Redo2,
  retry: RotateCw,
  search: Search,
  settings: Settings,
  allow: ShieldCheck,
  theme: SunMoon,
  preferences: SlidersHorizontal,
  delete: Trash2,
  warning: TriangleAlert,
  undo: Undo2,
  remove: X,
} as const satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

/** Whether a string names one of these icons, as in a data-icon attribute. */
export const isIconName = (name: string | undefined): name is IconName =>
  name !== undefined && Object.hasOwn(ICONS, name);

const escape = (value: string | number) =>
  String(value).replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!,
  );

/**
 * An icon as SVG markup, sized in CSS pixels and drawn in currentColor.
 *
 * @param name Which icon.
 * @param size Its width and height.
 * @returns The `<svg>` markup, hidden from assistive technology.
 */
export function icon(name: IconName, size = 16): string {
  const children = ICONS[name]
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .map(([key, value]) => `${key}="${escape(value ?? "")}"`)
          .join(" ")}/>`,
    )
    .join("");
  return `<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${children}</svg>`;
}

/**
 * Markup for an icon-only button's contents: the icon plus a visually hidden
 * label that names the button. Pair with the `.sr` rule in each surface.
 *
 * @param name Which icon.
 * @param label The button's accessible name.
 * @param size The icon's size.
 * @returns Inner HTML for the button.
 */
export function iconLabel(name: IconName, label: string, size = 16): string {
  return `${icon(name, size)}<span class="sr">${escape(label)}</span>`;
}

/**
 * Put an icon and visually hidden label into an existing button.
 *
 * @param button The button to fill.
 * @param name Which icon.
 * @param label Its accessible name, also shown as its tooltip.
 * @param size The icon's size.
 */
export function setIconButton(
  button: HTMLButtonElement,
  name: IconName,
  label: string,
  size = 16,
): void {
  button.innerHTML = iconLabel(name, label, size);
  button.title = label;
}

/** The visually hidden label rule, for shadow roots and extension pages. */
export const SR_ONLY =
  ".sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}";
