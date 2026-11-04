/**
 * A small DataFog tab on the right edge of the page that opens the side
 * panel, so the panel is one click away without pinning the extension. Lives
 * in a shadow root, like the badge.
 */

import { LOGO } from "./logo";

const STYLE = `
  :host { all: initial; }
  button {
    position: fixed; z-index: 2147483646; top: 50%; right: 0;
    transform: translateY(-50%); display: grid; place-items: center;
    padding: 8px 6px 8px 8px; border: 0; border-radius: 10px 0 0 10px;
    background: #1A2226; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    cursor: pointer; transition: padding-right 0.15s;
  }
  button:hover, button:focus-visible { padding-right: 12px; }
  button.warning::after {
    content: ""; position: absolute; top: 4px; left: 4px; width: 8px;
    height: 8px; border-radius: 999px; background: #b06000;
  }
  svg { display: block; }
`;

const TITLE = "Open DataFog";

/**
 * Add the tab to the page.
 *
 * @param onOpen Called when the tab is clicked.
 * @returns Sets the tab's warning, or clears it when called without one.
 */
export function mountTab(onOpen: () => void): (warning?: string) => void {
  const host = document.createElement("datafog-tab");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const button = document.createElement("button");
  button.type = "button";
  button.title = TITLE;
  button.setAttribute("aria-label", TITLE);
  button.innerHTML = LOGO;
  button.addEventListener("click", onOpen);
  root.append(style, button);
  document.documentElement.append(host);
  return (warning) => {
    button.classList.toggle("warning", warning !== undefined);
    button.title = warning ?? TITLE;
    button.setAttribute("aria-label", button.title);
  };
}
