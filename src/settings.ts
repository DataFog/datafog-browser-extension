/**
 * User settings, stored on this device only.
 *
 * chrome.storage.local, not sync: allowlist values are themselves sensitive.
 */

import { HOSTS } from "./site";

/** Found by Core's model rather than its rules. */
export const MODEL_ENTITIES = ["PERSON", "ADDRESS"];

/**
 * Detected by default: datafog-mcp's DEFAULT_ENTITIES, Core's labeled
 * account numbers and street addresses, and names and addresses, which
 * Core's model finds in the browser.
 */
export const DEFAULT_ENTITIES = [
  "ACCOUNT_NUMBER",
  "API_KEY",
  "BEARER_TOKEN",
  "CREDENTIAL_URI",
  "CREDIT_CARD",
  "EMAIL",
  "JWT",
  "NPI",
  "PRIVATE_KEY",
  "SSN",
  "STREET_ADDRESS",
  "US_ROUTING_NUMBER",
  // Together at the end: the model finds them, with its own caveats
  "PERSON",
  "ADDRESS",
];

/** Supported but off by default: they also match timestamps and IDs. */
export const OPT_IN_ENTITIES = [
  "PHONE",
  "DATE",
  "ZIP_CODE",
  "IP_ADDRESS",
  "UUID",
];

/**
 * Core's German identifiers. Supported, but not offered in settings for now.
 * Choosing any turns on Core's German locale.
 */
export const GERMAN_ENTITIES = [
  "DE_IBAN",
  "DE_VAT_ID",
  "DE_TAX_ID",
  "DE_SOCIAL_SECURITY_NUMBER",
  "DE_POSTAL_CODE",
  "DE_PASSPORT_NUMBER",
  "DE_RESIDENCE_PERMIT_NUMBER",
];

/** Types the settings show together, by how accurately they're found. */
export interface TypeGroup {
  name: string;
  /** More about how they're found, shown on hover. */
  about: string;
  types: string[];
}

/** The types the settings offer, from the most accurate to the least. */
export const TYPE_GROUPS: TypeGroup[] = [
  {
    name: "Pattern matched",
    about:
      "Found by their exact format, with check digits where the format has " +
      "them.",
    types: [
      "EMAIL",
      "CREDIT_CARD",
      "SSN",
      "US_ROUTING_NUMBER",
      "NPI",
      "API_KEY",
      "BEARER_TOKEN",
      "JWT",
      "PRIVATE_KEY",
      "CREDENTIAL_URI",
    ],
  },
  {
    name: "Best with a label",
    about:
      'Found after a label, such as "Account number:" or "Shipping ' +
      'address:". Sometimes missed without a label.',
    types: ["ACCOUNT_NUMBER", "STREET_ADDRESS"],
  },
  {
    name: "Best guess",
    about:
      "Found by a small model on your device. It may miss some, or flag " +
      "well-known names.",
    types: ["PERSON", "ADDRESS"],
  },
  {
    name: "May over-flag",
    about:
      "These can look like order numbers, timestamps or IDs, so they may be " +
      "flagged when they aren't sensitive. Off by default.",
    types: ["PHONE", "DATE", "ZIP_CODE", "IP_ADDRESS", "UUID"],
  },
];

/** Plain-language names for non-technical users. */
export const LABELS: Record<string, string> = {
  // A phrase from the user's own list, not one of Core's types
  DENYLIST: "Flagged phrase",
  ACCOUNT_NUMBER: "Account number",
  ADDRESS: "Mailing address",
  API_KEY: "API key",
  BEARER_TOKEN: "Access token",
  CREDENTIAL_URI: "Database connection string",
  CREDIT_CARD: "Card number",
  EMAIL: "Email address",
  JWT: "Login token",
  NPI: "Provider ID (NPI)",
  PERSON: "Name",
  PRIVATE_KEY: "Private key",
  SSN: "Social Security number",
  STREET_ADDRESS: "Street address",
  US_ROUTING_NUMBER: "Bank routing number",
  PHONE: "Phone number",
  DATE: "Date",
  ZIP_CODE: "ZIP code",
  IP_ADDRESS: "IP address",
  UUID: "UUID",
  DE_IBAN: "German IBAN",
  DE_VAT_ID: "German VAT ID",
  DE_TAX_ID: "German tax ID",
  DE_SOCIAL_SECURITY_NUMBER: "German social security number",
  DE_POSTAL_CODE: "German postal code",
  DE_PASSPORT_NUMBER: "German passport number",
  DE_RESIDENCE_PERMIT_NUMBER: "German residence permit number",
};

export interface Settings {
  /** Committed policy fingerprint, supplied on reads; never a setting. */
  policyVersion?: string;
  /**
   * Whether checking is on for the site at hand. Not saved: worked out from
   * `off` for the page asking.
   */
  enabled: boolean;
  /** The hosts checking is turned off for; any other site is checked. */
  off: string[];
  entities: string[];
  allowlist: string[];
  /** Phrases always found, ignoring case, even when allowed or not sensitive. */
  denylist: string[];
  /** Hold a send until the user has chosen what to do about found values. */
  blockSends: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  off: [],
  entities: DEFAULT_ENTITIES,
  allowlist: [],
  denylist: [],
  blockSends: false,
};

/**
 * Read settings, filling anything missing with defaults.
 *
 * @param host The site they're for, which sets whether checking is on; any
 *   site when left out.
 * @returns The current settings.
 */
export async function loadSettings(host?: string): Promise<Settings> {
  const response = await chrome.runtime.sendMessage({ type: "settings-get" });
  if (!response || response.error)
    throw new Error(response?.error ?? "settings_unavailable");
  return forSite(normalizeSettings(response), host);
}

/**
 * Settings for one site: whether checking is on there.
 *
 * @param settings Settings as saved.
 * @param host The site, or undefined for any site.
 * @returns The settings, with `enabled` for that site.
 */
export function forSite(settings: Settings, host?: string): Settings {
  return {
    ...settings,
    enabled: host === undefined || !settings.off.includes(host),
  };
}

/**
 * Whether sends are held: there's nothing to check them against otherwise.
 *
 * @param settings The current settings.
 * @returns True if a send with found values should be held.
 */
export function blockingSends(settings: Settings): boolean {
  return settings.enabled && settings.blockSends;
}

/**
 * Whether two lists hold the same items, in any order.
 *
 * @param a One list.
 * @param b The other.
 * @returns True if they match.
 */
function sameItems(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

/**
 * Whether two settings find the same values: the same types, allowlist and
 * deny list.
 *
 * @param a One set of settings.
 * @param b The other.
 * @returns True if a review made under one still holds under the other.
 */
export function sameChecks(a: Settings, b: Settings): boolean {
  return (
    sameItems(a.entities, b.entities) &&
    sameItems(a.allowlist, b.allowlist) &&
    sameItems(a.denylist, b.denylist)
  );
}

/**
 * Save settings.
 *
 * @param settings The settings to store.
 */
export async function saveSettings(settings: Settings): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: "settings-save",
    settings,
  });
  if (!response || response.error)
    throw new Error(response?.error ?? "settings_unavailable");
}

/** The settings lists of values the user keeps by hand. */
export type ListName = "allowlist" | "denylist";

/** What adding to a list did: added it, found it already there, or nothing. */
export type ListAdd = "added" | "listed" | "blank";

/**
 * Add a value to one of the user's lists, once.
 *
 * @param name The list.
 * @param value The value; surrounding spaces are dropped.
 * @returns Whether it was added, already listed, or blank.
 */
export async function addToList(
  name: ListName,
  value: string,
): Promise<ListAdd> {
  const item = value.trim();
  if (!item) return "blank";
  const settings = await loadSettings();
  if (settings[name].includes(item)) return "listed";
  await saveSettings({ ...settings, [name]: [...settings[name], item] });
  return "added";
}

/**
 * Remove a value from one of the user's lists.
 *
 * @param name The list.
 * @param value The value.
 */
export async function removeFromList(
  name: ListName,
  value: string,
): Promise<void> {
  const settings = await loadSettings();
  await saveSettings({
    ...settings,
    [name]: settings[name].filter((item) => item !== value),
  });
}

/** Keep legacy global-off and exact allowlist semantics during migration. */
export function normalizeSettings(saved: Partial<Settings>): Settings {
  const off = saved.off ?? (saved.enabled === false ? [...HOSTS] : []);
  return { ...DEFAULT_SETTINGS, ...saved, off };
}
