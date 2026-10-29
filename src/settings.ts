/**
 * User settings, stored on this device only.
 *
 * chrome.storage.local, not sync: allowlist values are themselves sensitive.
 */

/** Detected by default; mirrors datafog-mcp's DEFAULT_ENTITIES. */
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
];

/** Supported but off by default: they also match timestamps and IDs. */
export const OPT_IN_ENTITIES = ["PHONE", "DATE", "ZIP_CODE", "IP_ADDRESS"];

/** Plain-language names for non-technical users. */
export const LABELS: Record<string, string> = {
  API_KEY: "API key",
  BEARER_TOKEN: "Access token",
  CREDENTIAL_URI: "Database connection string",
  CREDIT_CARD: "Card number",
  EMAIL: "Email address",
  JWT: "Login token",
  NPI: "Provider ID (NPI)",
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
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  entities: DEFAULT_ENTITIES,
  allowlist: [],
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
 * Save settings.
 *
 * @param settings The settings to store.
 */
export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings });
}
