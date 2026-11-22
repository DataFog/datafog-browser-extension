/**
 * datafog "Redacted line" design tokens (datafog-lp/BRAND.md), for the
 * surfaces drawn inside host pages: the circle, its popup and the answer
 * control. Those live in closed shadow roots, so theme.css can't reach them;
 * keep these values in step with theme.css.
 *
 * Host pages get system fonts: loading Geist into a chat site would mean a
 * web-accessible font file every site can probe for. Extension pages
 * (sidebar, settings) load the bundled Geist from theme.css.
 */

export const BRAND = {
  night: "#0E1316",
  deck: "#1A2226",
  deckHigh: "#253035",
  fog: "#A7B2B1",
  mist: "#EEF0EF",
  steel: "#46505A",
  line: "#D2D8D7",
  orange: "#C0362C",
  orangeHover: "#A83226",
  orangeOnLight: "#A83226",
  signal: "#FF7A1A",
} as const;

/** Custom properties for a shadow root's `:host`, light and dark. */
export const HOST_TOKENS = `
  :host {
    --df-surface: #fff;
    --df-raised: ${BRAND.mist};
    --df-text: ${BRAND.night};
    --df-muted: ${BRAND.steel};
    --df-line: ${BRAND.line};
    --df-hover: rgb(14 19 22 / 0.06);
    --df-accent: ${BRAND.orange};
    --df-accent-hover: ${BRAND.orangeHover};
    --df-accent-text: ${BRAND.orangeOnLight};
    --df-token-bg: rgb(192 54 44 / 0.08);
    --df-token-text: ${BRAND.orangeOnLight};
    --df-primary: var(--df-text);
    --df-primary-text: var(--df-surface);
    --df-circle-border: transparent;
    --df-focus: ${BRAND.orange};
    --df-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
    --df-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --df-radius-pill: 999px;
    --df-radius-panel: 16px;
    --df-radius-control: 10px;
  }
  /* Dark under System when the browser prefers it, or when chosen */
  @media (prefers-color-scheme: dark) {
    :host(:not([data-theme="light"])) {
      --df-surface: ${BRAND.deck};
      --df-raised: ${BRAND.deckHigh};
      --df-text: ${BRAND.mist};
      --df-muted: ${BRAND.fog};
      --df-line: rgb(167 178 177 / 0.22);
      --df-hover: rgb(167 178 177 / 0.12);
      --df-accent-text: ${BRAND.signal};
      --df-token-bg: rgb(255 122 26 / 0.10);
      --df-token-text: ${BRAND.signal};
      --df-circle-border: rgb(238 240 239 / 0.32);
      --df-focus: ${BRAND.signal};
    }
  }
  :host([data-theme="dark"]) {
      --df-surface: ${BRAND.deck};
      --df-raised: ${BRAND.deckHigh};
      --df-text: ${BRAND.mist};
      --df-muted: ${BRAND.fog};
      --df-line: rgb(167 178 177 / 0.22);
      --df-hover: rgb(167 178 177 / 0.12);
      --df-accent-text: ${BRAND.signal};
      --df-token-bg: rgb(255 122 26 / 0.10);
      --df-token-text: ${BRAND.signal};
      --df-circle-border: rgb(238 240 239 / 0.32);
      --df-focus: ${BRAND.signal};
  }
`;
