/**
 * User settings, stored on this device only.
 *
 * chrome.storage.local, not sync: allowlist values are themselves sensitive.
 */

/** Found by Core's model rather than its rules. */
export const MODEL_ENTITIES = ["PERSON", "ADDRESS"];

/**
 * Detected by default: datafog-mcp's DEFAULT_ENTITIES, plus names and
 * addresses, which Core's model finds in the browser.
 */
export const DEFAULT_ENTITIES = [
  "API_KEY",
  "BEARER_TOKEN",
  "CREDENTIAL_URI",
  "CREDIT_CARD",
  "EMAIL",
  "JWT",
  "NPI",
  "PRIVATE_KEY",
  "SSN",
  "US_ROUTING_NUMBER",
  // Together at the end: the model finds them, with its own caveats
  "PERSON",
  "ADDRESS",
];

/** Supported but off by default: they also match timestamps and IDs. */
export const OPT_IN_ENTITIES = ["PHONE", "DATE", "ZIP_CODE", "IP_ADDRESS"];

/** Plain-language names for non-technical users. */
export const LABELS: Record<string, string> = {
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
  US_ROUTING_NUMBER: "Bank routing number",
  PHONE: "Phone number",
  DATE: "Date",
  ZIP_CODE: "ZIP code",
  IP_ADDRESS: "IP address",
};

export interface Settings {
  enabled: boolean;
  entities: string[];
  allowlist: string[];
  /** Hold a send until the user has chosen what to do about found values. */
  blockSends: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  entities: DEFAULT_ENTITIES,
  allowlist: [],
  blockSends: false,
};

/**
 * Read settings, filling anything missing with defaults.
 *
 * @returns The current settings.
 */
export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get<{
    settings?: Partial<Settings>;
  }>("settings");
  return { ...DEFAULT_SETTINGS, ...stored.settings };
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
 * Whether two settings find the same values: the same types and allowlist.
 *
 * @param a One set of settings.
 * @param b The other.
 * @returns True if a review made under one still holds under the other.
 */
export function sameChecks(a: Settings, b: Settings): boolean {
  return (
    sameItems(a.entities, b.entities) && sameItems(a.allowlist, b.allowlist)
  );
}

/**
 * Save settings.
 *
 * @param settings The settings to store.
 */
export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings });
}
