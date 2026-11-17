/**
 * What DataFog needs to know about each chat site: where its chat box,
 * send button and answers are, and the empty chat box's size and shape, so
 * the badge can match it. Sites change their markup without notice, so each list
 * runs from the most specific selector to the most general.
 */

/**
 * The badge's size and shape before DataFog has seen the site's chat box
 * empty: the empty box's height and corner radius, as measured. Once the box
 * is seen empty, the badge measures it instead.
 */
export interface BadgeShape {
  /** Width and height, in pixels. */
  size: number;
  /** Corner radius, as CSS. */
  radius: string;
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
  // Its pill-shaped chat box
  badge: { size: 56, radius: "28px" },
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
  // Its rounded card, with the model picker and send button inside
  badge: { size: 103, radius: "14px" },
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
  // Its pill-shaped chat box
  badge: { size: 64, radius: "32px" },
};

const GROK: Site = {
  name: "Grok",
  composers: [
    "form[data-composer] .ProseMirror",
    "form [contenteditable='true']",
    "form textarea",
  ],
  box: "form[data-composer], form",
  sendButtons: '[data-testid="chat-submit"], button[type="submit"]',
  // The answer's text, without the hidden "Grok" heading
  answers: ['[data-testid="assistant-message"] .response-content-markdown'],
  // Its pill-shaped chat box
  badge: { size: 58, radius: "29px" },
};

const DEEPSEEK: Site = {
  name: "DeepSeek",
  composers: ['textarea[name="search"]', "textarea"],
  // Its class names are hashed, so the box is found by its shape: the
  // rounded card two levels above the chat box
  box: "div:has(> div > div > textarea)",
  sendButtons: '[role="button"].ds-button--primary.ds-button--circle',
  // The answer's text, without its thinking
  answers: [".ds-markdown.ds-assistant-message-main-content"],
  // Its rounded card, with the attach and send buttons inside
  badge: { size: 124, radius: "24px" },
};

const SITES: Record<string, Site> = {
  "chatgpt.com": CHATGPT,
  "claude.ai": CLAUDE,
  "gemini.google.com": GEMINI,
  "grok.com": GROK,
  "chat.deepseek.com": DEEPSEEK,
};

/** The hosts DataFog runs on, each with its own profile. */
export const HOSTS = Object.keys(SITES);

/** Each site's host and name, for settings. */
export const SITE_NAMES = Object.entries(SITES).map(([host, { name }]) => ({
  host,
  name,
}));

/**
 * Each site's name, as a list joined with "or", for messages.
 *
 * @returns The names, such as "ChatGPT, Claude or Gemini".
 */
export function siteNames(): string {
  const names = SITE_NAMES.map(({ name }) => name);
  const last = names.pop();
  return names.length ? `${names.join(", ")} or ${last}` : `${last}`;
}

/**
 * The site a page belongs to.
 *
 * @param host The page's host name.
 * @returns The site, or ChatGPT's for a host DataFog doesn't know.
 */
export function siteFor(host: string): Site {
  return SITES[host] ?? CHATGPT;
}
