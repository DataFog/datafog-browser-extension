/**
 * What DataFog needs to know about each chat site: where its chat box,
 * send button and answers are, and how its own buttons look, so the badge
 * can match them. Sites change their markup without notice, so each list
 * runs from the most specific selector to the most general.
 */

/** How the badge matches a site's own chat box buttons. */
export interface BadgeShape {
  /** Width and height, in pixels. */
  size: number;
  /** Corner radius, as CSS. */
  radius: string;
  /**
   * How far above the chat box's bottom edge its buttons are centered, in
   * pixels, so the badge lines up with them.
   */
  centerInset: number;
}

export interface Site {
  /** The site's name, as users know it. */
  name: string;
  /** The chat box, the element text is typed into. */
  composers: string[];
  /** The outer chat box around it, which outlasts changes to the editor. */
  box: string;
  /** The site's send buttons. */
  sendButtons: string;
  /** The site's answers, newest last. */
  answers: string[];
  badge: BadgeShape;
}

const CHATGPT: Site = {
  name: "ChatGPT",
  composers: [
    "#prompt-textarea",
    "form [contenteditable='true']",
    "form textarea",
  ],
  box: "form",
  sendButtons:
    'button[type="submit"], [data-testid="send-button"], #composer-submit-button',
  answers: [
    "[data-dil-response]",
    '[data-message-author-role="assistant"]',
    'article[data-turn="assistant"]',
    ".markdown",
  ],
  // Its round voice and send buttons
  badge: { size: 36, radius: "50%", centerInset: 26 },
};

const CLAUDE: Site = {
  name: "Claude",
  composers: [
    '[data-testid="chat-input"]',
    "fieldset [contenteditable='true']",
    "fieldset textarea",
  ],
  box: '[data-cds-part="composer-card"], fieldset',
  sendButtons:
    '[data-testid="chat-input-send"], button[aria-label="Send message"]',
  // The answer's prose, without the hidden heading, thinking summary and
  // timestamp the whole message also holds
  answers: [
    '[data-testid="assistant-message"] [data-cds="Prose"]',
    '[data-testid="assistant-message"] .standard-markdown',
  ],
  // Its rounded square voice and send buttons
  badge: { size: 28, radius: "8px", centerInset: 22 },
};

const GEMINI: Site = {
  name: "Gemini",
  composers: [
    'rich-textarea .ql-editor[contenteditable="true"]',
    "input-area-v2 [contenteditable='true']",
    "input-area-v2 textarea",
  ],
  box: "input-area-v2",
  sendButtons: 'button[aria-label="Send message"], .send-button button',
  // The answer's text, without the "Gemini said" label and thoughts
  answers: ["model-response message-content .markdown"],
  // Its round upload, voice and send buttons
  badge: { size: 32, radius: "50%", centerInset: 32 },
};

const SITES: Record<string, Site> = {
  "chatgpt.com": CHATGPT,
  "claude.ai": CLAUDE,
  "gemini.google.com": GEMINI,
};

/** The hosts DataFog runs on, each with its own profile. */
export const HOSTS = Object.keys(SITES);

/** Each site's host and name, for settings. */
export const SITE_NAMES = Object.entries(SITES).map(([host, { name }]) => ({
  host,
  name,
}));

/**
 * The site a page belongs to.
 *
 * @param host The page's host name.
 * @returns The site, or ChatGPT's for a host DataFog doesn't know.
 */
export function siteFor(host: string): Site {
  return SITES[host] ?? CHATGPT;
}
