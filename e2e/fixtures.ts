import {
  chromium,
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
  type Worker,
} from "@playwright/test";
import { constants } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  TestExtensionInstallation,
  type ExtensionInstaller,
} from "./extension-installation";

import { createPinnedPage, requireContext } from "./browser-context";

export { expect };
export const SAMPLE =
  "my email is jane@example.com and card 4111 1111 1111 1111";

type NodeInfo = {
  nodeName: string;
  nodeId: number;
  backendNodeId: number;
  children?: NodeInfo[];
  shadowRoots?: NodeInfo[];
};

export interface ShadowState {
  text: string;
  matches: number;
  pressed: string | null;
  checked: string | null;
  title: string;
  visible: boolean;
  disabled: boolean;
  rect: { x: number; y: number; width: number; height: number };
  /** The top right corner's radius, as computed. */
  radius: string;
  color: string;
  backgroundColor: string;
  focused: boolean;
  textOverflow: string;
  scrollWidth: number;
  clientWidth: number;
  animationName: string;
  animationDuration: string;
  transitionDuration: string;
}

/** DevTools errors for a host removed between calls, worth one more look. */
const REPLACED = /Host replaced|Could not find node|No node with given id/;

/** Inspect closed roots through DevTools, preserving production isolation. */
export class ClosedShadow {
  constructor(
    private page: Page,
    private hostSelector: string,
  ) {}

  async state(selector: string): Promise<ShadowState> {
    // The extension can replace a host between DevTools calls, such as an
    // answer's originals redrawn for a theme change, so look it up again
    for (let attempt = 1; ; attempt++) {
      await this.page
        .locator(this.hostSelector)
        .first()
        .waitFor({ state: "attached" });
      try {
        return await this.inspect(selector);
      } catch (error) {
        if (attempt >= 5 || !REPLACED.test(String(error))) throw error;
        await this.page.waitForTimeout(50);
      }
    }
  }

  /**
   * Read one element's state inside the host's closed shadow root.
   *
   * @param selector The element's selector inside the shadow root.
   * @returns The element's state.
   * @throws If the host was replaced while it was being read.
   */
  private async inspect(selector: string): Promise<ShadowState> {
    const session = await this.page.context().newCDPSession(this.page);
    try {
      const { root } = await session.send("DOM.getDocument", {
        depth: -1,
        pierce: true,
      });
      const { nodeId } = await session.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: this.hostSelector,
      });
      if (!nodeId) throw new Error(`Host replaced: ${this.hostSelector}`);
      const { node } = (await session.send("DOM.describeNode", {
        nodeId,
        depth: 1,
        pierce: true,
      })) as { node: NodeInfo };
      const shadow = node.shadowRoots?.[0];
      if (!shadow) throw new Error(`No shadow root: ${this.hostSelector}`);
      const { object } = await session.send("DOM.resolveNode", {
        backendNodeId: shadow.backendNodeId,
      });
      const response = await session.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: `function(selector) {
          const el = this.querySelector(selector);
          if (!el) throw new Error('Missing shadow element: ' + selector);
          const r = el.getBoundingClientRect();
          return {
            text: el.textContent || '', matches: this.querySelectorAll(selector).length, pressed: el.getAttribute('aria-pressed'), checked: el.getAttribute('aria-checked'), title: el.getAttribute('title') || '',
            visible: el.checkVisibility(), disabled: Boolean(el.disabled),
            rect: {x:r.x,y:r.y,width:r.width,height:r.height},
            radius: getComputedStyle(el).borderTopRightRadius,
            color: getComputedStyle(el).color,
            backgroundColor: getComputedStyle(el).backgroundColor,
            focused: this.activeElement === el,
            textOverflow: getComputedStyle(el).textOverflow,
            scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
            animationName: getComputedStyle(el).animationName,
            animationDuration: getComputedStyle(el).animationDuration,
            transitionDuration: getComputedStyle(el).transitionDuration
          };
        }`,
        arguments: [{ value: selector }],
        returnByValue: true,
      });
      if (response.exceptionDetails)
        throw new Error(response.exceptionDetails.text);
      const state: ShadowState = response.result.value;
      return state;
    } finally {
      await session.detach();
    }
  }

  async click(selector: string): Promise<void> {
    await expect
      .poll(
        async () => {
          const state = await this.state(selector);
          return state.visible && !state.disabled;
        },
        { message: `${selector} should become actionable` },
      )
      .toBe(true);
    const { rect } = await this.state(selector);
    // A real mouse click carries the user gesture needed to open a side panel.
    await this.page.mouse.click(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
  }
}

/** Set each included finding to Redact, then commit the exact refreshed plan. */
export async function redactAll(badge: ClosedShadow): Promise<void> {
  const rows = ".preview li";
  const count = (await badge.state(rows)).matches;
  for (let index = 0; index < count; index++) {
    const row = `${rows}:nth-child(${index + 1})`;
    if ((await badge.state(`${row} .choose`)).checked !== "true") continue;
    const selector = `${row} .mode[data-mode="redact"]`;
    await expect
      .poll(async () => (await badge.state(selector)).disabled)
      .toBe(false);
    await badge.click(selector);
    await expect
      .poll(async () => (await badge.state(selector)).pressed)
      .toBe("true");
    await expect
      .poll(async () => (await badge.state(".pseudonymize")).disabled)
      .toBe(false);
  }
  await badge.click(".pseudonymize");
}

/**
 * Check the badge's size and corner radius, and that it's level with the
 * chat box's bottom edge.
 *
 * @param badge The badge.
 * @param box The chat box.
 * @param size The badge's expected width and height, in pixels.
 * @param radius The badge's expected corner radius, as computed.
 */
export async function expectBadgeFitsBox(
  badge: ClosedShadow,
  box: Locator,
  size: number,
  radius: string,
): Promise<void> {
  const { rect, radius: actual } = await badge.state(".dot");
  expect([rect.width, rect.height]).toEqual([size, size]);
  expect(actual).toBe(radius);
  const bounds = await box.boundingBox();
  expect(
    Math.abs(rect.y + rect.height - (bounds!.y + bounds!.height)),
  ).toBeLessThanOrEqual(1);
}

export type ChatOptions = {
  path?: string;
  composer?: "contenteditable" | "textarea" | "none";
  /** Which chat site's markup to stand in for. */
  site?: "chatgpt" | "claude" | "gemini" | "grok" | "deepseek";
};

const ORIGINS = {
  chatgpt: "https://chatgpt.com",
  claude: "https://claude.ai",
  gemini: "https://gemini.google.com",
  grok: "https://grok.com",
  deepseek: "https://chat.deepseek.com",
};

/** Controlled Claude DOM: a card in a fieldset, with a plain send button. */
function claudeHTML(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Claude fixture</title>
    <style>
      body{font:16px system-ui;margin:0;padding:32px} main{max-width:760px;margin:auto}
      fieldset{border:0;margin:32px 60px 0 0;padding:0}
      [data-cds-part=composer-card]{border:1px solid #888;border-radius:14px;padding:8px}
      [data-testid=chat-input]{min-height:50px;white-space:pre-wrap}
      .row{display:flex;justify-content:flex-end}
      .row button{width:28px;height:28px;border-radius:8px}
    </style></head><body>
    <main><section id="answers"></section><fieldset><div data-cds-part="composer-card">
    <div data-testid="chat-input" role="textbox" contenteditable="true" aria-label="Write your prompt to Claude"></div>
    <div class="row"><button type="button" data-testid="chat-input-send" aria-label="Send message">↑</button></div>
    </div></fieldset><output id="sent-count">0</output><output id="sent-text"></output></main>
    <script>
      const sent=document.querySelector('#sent-count');
      const capture=()=>{const editor=document.querySelector('[contenteditable],textarea');document.querySelector('#sent-text').textContent=editor?.value??editor?.innerText??''};
      const send=()=>{capture();sent.textContent=String(Number(sent.textContent)+1)};
      document.querySelector('[data-testid=chat-input-send]').addEventListener('click', send);
      document.querySelector('[data-testid=chat-input]').addEventListener('keydown', e=>{
        if(e.key==='Enter' && !e.shiftKey && !e.isComposing){e.preventDefault();send()}
      });
    </script></body></html>`;
}

/** Controlled Gemini DOM: a Quill editor in a rounded box, no form. */
function geminiHTML(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Gemini fixture</title>
    <style>
      body{font:16px system-ui;margin:0;padding:32px} main{max-width:760px;margin:auto}
      input-area-v2{display:flex;align-items:center;gap:8px;margin:32px 60px 0 0;padding:16px;border:1px solid #888;border-radius:32px}
      rich-textarea{flex:1} .ql-editor{min-height:24px;white-space:pre-wrap}
      input-area-v2 button{width:32px;height:32px;border-radius:50%}
    </style></head><body>
    <main><section id="answers"></section><input-area-v2>
    <rich-textarea><div class="ql-editor" role="textbox" contenteditable="true" aria-label="Enter a prompt for Gemini"></div></rich-textarea>
    <div class="send-button"><button type="submit" aria-label="Send message">↑</button></div>
    </input-area-v2><output id="sent-count">0</output><output id="sent-text"></output></main>
    <script>
      const sent=document.querySelector('#sent-count');
      const capture=()=>{const editor=document.querySelector('[contenteditable],textarea');document.querySelector('#sent-text').textContent=editor?.value??editor?.innerText??''};
      const send=()=>{capture();sent.textContent=String(Number(sent.textContent)+1)};
      document.querySelector('[aria-label="Send message"]').addEventListener('click', send);
      document.querySelector('.ql-editor').addEventListener('keydown', e=>{
        if(e.key==='Enter' && !e.shiftKey && !e.isComposing){e.preventDefault();send()}
      });
    </script></body></html>`;
}

/** Controlled Grok DOM: a rounded composer form with a submit button. */
function grokHTML(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Grok fixture</title>
    <style>
      body{font:16px system-ui;margin:0;padding:32px} main{max-width:760px;margin:auto}
      form{display:flex;align-items:center;gap:8px;margin:32px 60px 0 0;padding:12px;border:1px solid #888;border-radius:29px}
      .ProseMirror{flex:1;min-height:24px;white-space:pre-wrap}
      form button{width:32px;height:32px;border-radius:50%}
    </style></head><body>
    <main><section id="answers"></section>
    <form data-composer data-composer-surface="true">
    <div class="tiptap ProseMirror" role="textbox" contenteditable="true" aria-label="Message Grok"></div>
    <button type="submit" data-testid="chat-submit" aria-label="Send">↑</button>
    </form><output id="sent-count">0</output><output id="sent-text"></output></main>
    <script>
      const form=document.querySelector('form');
      const sent=document.querySelector('#sent-count');
      const capture=()=>{const editor=document.querySelector('[contenteditable],textarea');document.querySelector('#sent-text').textContent=editor?.value??editor?.innerText??''};
      form.addEventListener('submit', e=>{e.preventDefault(); capture();sent.textContent=String(Number(sent.textContent)+1)});
      form.addEventListener('keydown', e=>{
        if(e.key==='Enter' && !e.shiftKey && !e.isComposing){e.preventDefault();form.requestSubmit()}
      });
    </script></body></html>`;
}

/** Controlled DeepSeek DOM: a textarea in an unnamed card, div buttons. */
function deepseekHTML(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>DeepSeek fixture</title>
    <style>
      body{font:16px system-ui;margin:0;padding:32px} main{max-width:760px;margin:auto}
      #card{margin:32px 60px 0 0;padding:12px;border:1px solid #888;border-radius:24px}
      textarea{width:100%;min-height:60px;border:0}
      .row{display:flex;justify-content:flex-end}
      [role=button]{width:34px;height:34px;border-radius:50%;background:#3964fe}
    </style></head><body>
    <main><section id="answers"></section>
    <div id="card"><div><div><textarea name="search" placeholder="Message DeepSeek"></textarea></div></div>
    <div class="row"><div role="button" class="ds-button ds-button--primary ds-button--circle"></div></div>
    </div><output id="sent-count">0</output><output id="sent-text"></output></main>
    <script>
      const sent=document.querySelector('#sent-count');
      const capture=()=>{const editor=document.querySelector('[contenteditable],textarea');document.querySelector('#sent-text').textContent=editor?.value??editor?.innerText??''};
      const send=()=>{capture();sent.textContent=String(Number(sent.textContent)+1)};
      document.querySelector('[role=button]').addEventListener('click', send);
      document.querySelector('textarea').addEventListener('keydown', e=>{
        if(e.key==='Enter' && !e.shiftKey && !e.isComposing){e.preventDefault();send()}
      });
    </script></body></html>`;
}

/** Controlled ChatGPT DOM, served at the real origin for manifest injection. */
function chatHTML(options: ChatOptions): string {
  if (options.site === "claude") return claudeHTML();
  if (options.site === "gemini") return geminiHTML();
  if (options.site === "grok") return grokHTML();
  if (options.site === "deepseek") return deepseekHTML();
  const composer = options.composer ?? "contenteditable";
  const editor =
    composer === "none"
      ? ""
      : composer === "textarea"
        ? '<textarea id="prompt-textarea" aria-label="Message"></textarea>'
        : '<div id="prompt-textarea" role="textbox" aria-label="Message" contenteditable="true"></div>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>ChatGPT fixture</title>
    <style>
      :root {color-scheme:light dark} body{font:16px system-ui;margin:0;padding:32px}
      main{max-width:760px;margin:auto} form{position:relative;margin:32px 40px 0 0}
      #prompt-textarea{display:block;box-sizing:border-box;width:100%;min-height:120px;max-height:320px;overflow:auto;border:1px solid #888;padding:16px;white-space:pre-wrap}
      button{padding:10px} #answers{white-space:pre-wrap}
    </style></head><body>
    <main><header>Editor integration fixture</header>
    <section id="answers"></section><form>${editor}
    <input type="file" aria-label="Attach file"><button type="submit" data-testid="send-button">Send</button>
    </form><output id="sent-count">0</output><output id="sent-text"></output></main>
    <script>
      const form=document.querySelector('form');
      const sent=document.querySelector('#sent-count');
      const capture=()=>{const editor=document.querySelector('[contenteditable],textarea');document.querySelector('#sent-text').textContent=editor?.value??editor?.innerText??''};
      form.addEventListener('submit', e=>{e.preventDefault(); capture();sent.textContent=String(Number(sent.textContent)+1)});
      form.addEventListener('keydown', e=>{
        if(e.key==='Enter' && !e.shiftKey && !e.isComposing){e.preventDefault();form.requestSubmit()}
      });
    </script></body></html>`;
}

/**
 * The browser the tests run in: Google Chrome, or Microsoft Edge with
 * `E2E_BROWSER=msedge`.
 *
 * @returns Playwright's channel for it.
 */
function browserChannel(): "chrome" | "msedge" {
  const browser = process.env.E2E_BROWSER ?? "chrome";
  if (browser !== "chrome" && browser !== "msedge")
    throw new Error(`E2E_BROWSER must be chrome or msedge, not ${browser}`);
  return browser;
}

function extensionInstaller(
  session: CDPSession,
  activate: () => Promise<void> = async () => {},
): ExtensionInstaller {
  return {
    list: async () => {
      await activate();
      return (await session.send("Extensions.getExtensions")).extensions;
    },
    load: async (extensionPath) => {
      await activate();
      return (
        await session.send("Extensions.loadUnpacked", { path: extensionPath })
      ).id;
    },
    uninstall: async (id) => {
      await activate();
      await session.send("Extensions.uninstall", { id });
    },
  };
}

export class Extension {
  context!: BrowserContext;
  worker!: Worker;
  id!: string;
  private debugPort!: string;
  private attached: Browser[] = [];
  private pages = new Map<string, ChatOptions>();
  private installed = false;
  private authLoaded = false;
  private borrowedBrowser?: Browser;
  private ownedPages = new Set<Page>();
  private currentChat?: Page;
  private profileControl?: Page;
  private readonly installation: TestExtensionInstallation;
  private readonly suspendedOriginal?: { id: string; path: string };

  constructor(
    private profile: string,
    private headless: boolean,
    private config: {
      live?: boolean;
      storageState?: string;
      cdpEndpoint?: string;
      browserContextId?: string;
      suspendedExtensionId?: string;
      suspendedExtensionPath?: string;
    } = {},
  ) {
    if (config.cdpEndpoint && !config.browserContextId)
      throw new Error(
        "Borrowed Chrome requires an explicit LIVE_BROWSER_CONTEXT_ID",
      );
    this.installation = new TestExtensionInstallation(
      path.join(profile, "unpacked-extension"),
    );
    const id = config.suspendedExtensionId;
    const originalPath = config.suspendedExtensionPath;
    if (id || originalPath) {
      if (
        !id ||
        !originalPath ||
        !/^[a-p]{32}$/.test(id) ||
        !path.isAbsolute(originalPath) ||
        !config.cdpEndpoint
      ) {
        throw new Error(
          "An inherited suspension requires the exact extension id, absolute path, and active-browser endpoint",
        );
      }
      this.suspendedOriginal = { id, path: originalPath };
    }
  }

  private async verifyPage(page: Page): Promise<void> {
    if (!this.borrowedBrowser) return;
    const session = await page.context().newCDPSession(page);
    try {
      requireContext(
        (await session.send("Target.getTargetInfo")).targetInfo,
        this.config.browserContextId!,
      );
    } finally {
      await session.detach();
    }
  }

  private async newOwnedPage(): Promise<Page> {
    if (!this.borrowedBrowser) {
      const page = await this.context.newPage();
      this.ownedPages.add(page);
      return page;
    }
    const browser = this.borrowedBrowser;
    const session = await browser.newBrowserCDPSession();
    try {
      const page = await createPinnedPage(this.config.browserContextId!, {
        create: async (url, browserContextId) => {
          // Normal Chrome profiles expose target context IDs that are not
          // accepted by Target.createTarget. A verified opener binds the new
          // tab to that existing profile instead of Chrome's last-used profile.
          const pages = browser
            .contexts()
            .flatMap((context) => context.pages());
          const candidates = [
            ...pages.filter((candidate) =>
              candidate.url().startsWith("https://chatgpt.com/"),
            ),
            ...pages.filter(
              (candidate) =>
                !candidate.url().startsWith("https://chatgpt.com/"),
            ),
          ];
          let anchor: Page | undefined;
          for (const candidate of candidates) {
            if (candidate.isClosed()) continue;
            const targetSession = await candidate
              .context()
              .newCDPSession(candidate);
            try {
              if (
                (await targetSession.send("Target.getTargetInfo")).targetInfo
                  .browserContextId === browserContextId
              ) {
                anchor = candidate;
                break;
              }
            } finally {
              await targetSession.detach();
            }
          }
          if (!anchor)
            throw new Error(
              "No existing page belongs to the selected Chrome profile",
            );
          await this.verifyPage(anchor);
          await anchor.evaluate((ownedUrl) => {
            window.open(ownedUrl, "_blank");
          }, url);
          for (let attempt = 0; attempt < 100; attempt++) {
            const targets = (
              await session.send("Target.getTargets")
            ).targetInfos.filter(
              (target) => target.type === "page" && target.url === url,
            );
            if (targets.length === 1) return targets[0].targetId;
            if (targets.length > 1)
              throw new Error("The owned page target is ambiguous");
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error("The selected profile did not open the owned page");
        },
        resolve: async (url) => {
          for (let attempt = 0; attempt < 100; attempt++) {
            const candidatePage = browser
              .contexts()
              .flatMap((context) => context.pages())
              .find((candidate) => candidate.url() === url);
            if (candidatePage) {
              const targetSession = await candidatePage
                .context()
                .newCDPSession(candidatePage);
              try {
                return {
                  page: candidatePage,
                  target: (await targetSession.send("Target.getTargetInfo"))
                    .targetInfo,
                };
              } finally {
                await targetSession.detach();
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error(
            "The explicitly created browser target did not attach",
          );
        },
        close: async (targetId) => {
          await session.send("Target.closeTarget", { targetId });
        },
      });
      this.ownedPages.add(page);
      return page;
    } finally {
      await session.detach();
    }
  }

  private async activateProfile(): Promise<void> {
    if (!this.borrowedBrowser) return;
    if (!this.profileControl || this.profileControl.isClosed())
      throw new Error("The pinned profile control page is unavailable");
    await this.verifyPage(this.profileControl);
    await this.profileControl.bringToFront();
    await this.verifyPage(this.profileControl);
  }

  private async verifyWorker(): Promise<void> {
    if (!this.borrowedBrowser) return;
    const session = await this.borrowedBrowser.newBrowserCDPSession();
    try {
      const targets = (
        await session.send("Target.getTargets")
      ).targetInfos.filter(
        (target) =>
          target.type === "service_worker" &&
          target.url.startsWith(`chrome-extension://${this.id}/`),
      );
      if (targets.length !== 1)
        throw new Error(
          "The test extension worker target is ambiguous or missing",
        );
      requireContext(targets[0], this.config.browserContextId!);
    } finally {
      await session.detach();
    }
  }

  async start(): Promise<void> {
    const extensionPath = path.join(this.profile, "unpacked-extension");
    if (!this.installed) {
      await base.step("Copy the unpacked extension", () =>
        cp(
          path.resolve(process.env.DATAFOG_TEST_BUILD_ROOT ?? ".", "dist"),
          extensionPath,
          {
            recursive: true,
            mode: constants.COPYFILE_FICLONE,
          },
        ),
      );
      this.installed = true;
    }
    if (this.config.cdpEndpoint) {
      const endpoint = new URL(this.config.cdpEndpoint);
      if (
        endpoint.protocol !== "http:" ||
        !["127.0.0.1", "localhost"].includes(endpoint.hostname)
      )
        throw new Error(
          "The interactive test browser must use a localhost Chrome endpoint",
        );
      this.borrowedBrowser = await chromium.connectOverCDP(
        this.config.cdpEndpoint,
      );
      this.profileControl = await this.newOwnedPage();
      this.context = this.profileControl.context();
      await this.profileControl.goto("chrome://extensions/");
      await this.activateProfile();
      this.debugPort = endpoint.port;
    } else {
      this.context = await chromium.launchPersistentContext(this.profile, {
        channel: browserChannel(),
        headless: this.headless,
        ignoreDefaultArgs: ["--disable-extensions"],
        viewport: { width: 1280, height: 900 },
        args: [
          "--remote-debugging-port=0",
          // Enable Chrome's extension-installation DevTools API in this profile.
          "--enable-unsafe-extension-debugging",
        ],
      });
    }
    if (!this.config.live) {
      await base.step("Start tracing and route provider fixtures", async () => {
        await this.context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true,
        });
        for (const origin of Object.values(ORIGINS))
          await this.context.route(`${origin}/**`, (route) => {
            const options = this.pages.get(route.request().url()) ?? {};
            return route.fulfill({
              contentType: "text/html",
              body: chatHTML(options),
            });
          });
      });
    } else if (!this.authLoaded && !this.borrowedBrowser) {
      if (this.config.storageState)
        await this.context.setStorageState(this.config.storageState);
      this.authLoaded = true;
    }
    await base.step("Install the unpacked extension", async () => {
      const installer = await this.context.browser()!.newBrowserCDPSession();
      try {
        const api = extensionInstaller(installer, () => this.activateProfile());
        this.id = await this.installation.load(
          api,
          Boolean(this.borrowedBrowser),
          this.suspendedOriginal,
        );
      } finally {
        await installer.detach();
      }
    });
    const isExtensionWorker = (worker: Worker) =>
      worker.url().startsWith(`chrome-extension://${this.id}/`);
    this.worker =
      this.context.serviceWorkers().find(isExtensionWorker) ??
      (await this.context.waitForEvent("serviceworker", {
        predicate: isExtensionWorker,
      }));
    await this.verifyWorker();
    if (!this.borrowedBrowser) {
      this.debugPort = (
        await readFile(path.join(this.profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
    }
    await base.step("Dismiss the install welcome page", () =>
      this.closeWelcome(),
    );
  }

  /**
   * A new install opens the welcome page. Tests start without it; the
   * welcome tests open it themselves.
   */
  private async closeWelcome(): Promise<void> {
    const url = `chrome-extension://${this.id}/welcome.html`;
    for (let tries = 0; tries < 30; tries++) {
      const welcome = this.context.pages().find((page) => page.url() === url);
      if (welcome) {
        await this.verifyPage(welcome);
        await welcome.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Open the welcome page, as a new install would.
   *
   * @returns The page.
   */
  async welcome(): Promise<Page> {
    const page = await this.newOwnedPage();
    await page.goto(`chrome-extension://${this.id}/welcome.html`);
    return page;
  }

  async newChat(options: ChatOptions = {}): Promise<Page> {
    const origin = ORIGINS[options.site ?? "chatgpt"];
    const url = new URL(options.path ?? "/", origin).href;
    this.pages.set(url, options);
    const page = await this.newOwnedPage();
    this.currentChat = page;
    await page.goto(url, {
      waitUntil: this.config.live ? "domcontentloaded" : "load",
    });
    if (options.composer !== "none")
      await page.locator("datafog-badge").waitFor({ state: "attached" });
    return page;
  }

  badge(page: Page): ClosedShadow {
    return this.shadow(page, "datafog-badge");
  }

  shadow(page: Page, selector: string): ClosedShadow {
    return new ClosedShadow(page, selector);
  }

  async options(): Promise<Page> {
    const page = await this.newOwnedPage();
    await page.goto(`chrome-extension://${this.id}/options.html`);
    await expect(page.locator('input[value="EMAIL"]')).toBeAttached();
    return page;
  }

  async panel(windowId?: number, providedChat?: Page): Promise<Page> {
    let chat =
      providedChat ??
      this.currentChat ??
      this.context
        .pages()
        .find((p) => p.url().startsWith("https://chatgpt.com/"));
    if (windowId !== undefined && !providedChat) {
      const tabs = await this.worker.evaluate(
        async (id) => chrome.tabs.query({ active: true, windowId: id }),
        windowId,
      );
      chat = this.context.pages().find((p) => p.url() === tabs[0]?.url);
    }
    chat ??= await this.newChat();
    await chat.bringToFront();
    await this.verifyPage(chat);
    const tabSession = await chat.context().newCDPSession(chat);
    const { targetInfo } = await tabSession.send("Target.getTargetInfo");
    await tabSession.detach();
    const targetWindow =
      windowId ??
      (await this.worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        if (tab?.windowId === undefined)
          throw new Error("No active extension window");
        return tab.windowId;
      }));
    const alreadyOpen = await this.worker.evaluate(
      async (id) =>
        (
          await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.SIDE_PANEL],
          })
        ).some((context) => context.windowId === id),
      targetWindow,
    );
    if (!alreadyOpen) {
      // Exercise Chrome's actual toolbar action; no popup-only sidebar shortcut.
      const action = await this.context.browser()!.newBrowserCDPSession();
      try {
        await this.activateProfile();
        await chat.bringToFront();
        await this.verifyPage(chat);
        const expectedWindow = await action.send("Browser.getWindowForTarget", {
          targetId: targetInfo.targetId,
        });
        const targets = await action.send("Target.getTargets", {
          filter: [{ type: "tab", exclude: false }, { exclude: true }],
        });
        const matching = [];
        for (const target of targets.targetInfos) {
          const metadata: unknown = target.embedderData;
          if (
            target.url !== chat.url() ||
            target.browserContextId !== targetInfo.browserContextId ||
            !metadata ||
            typeof metadata !== "object" ||
            !("tabActive" in metadata) ||
            metadata.tabActive !== true
          )
            continue;
          const nativeWindow = await action.send("Browser.getWindowForTarget", {
            targetId: target.targetId,
          });
          if (nativeWindow.windowId === expectedWindow.windowId)
            matching.push(target);
        }
        if (matching.length !== 1)
          throw new Error(
            "The toolbar action needs one verified active tab target",
          );
        await action.send("Extensions.triggerAction", {
          id: this.id,
          targetId: matching[0].targetId,
        });
      } finally {
        await action.detach();
      }
    }
    // Chrome's side panel is a native extension view, not an extension tab.
    // Playwright does not auto-attach it when created. A second public CDP
    // connection attaches existing page targets without weakening sender checks.
    await expect
      .poll(async () => {
        const contexts = await this.worker.evaluate(() =>
          chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.SIDE_PANEL],
          }),
        );
        return contexts.length;
      })
      .toBeGreaterThan(0);
    const browser = await chromium.connectOverCDP(
      `http://127.0.0.1:${this.debugPort}`,
    );
    this.attached.push(browser);
    const context = browser.contexts()[0];
    if (!this.config.live) {
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
      });
    }
    const candidates = browser
      .contexts()
      .flatMap((candidate) => candidate.pages())
      .filter((p) => p.url() === `chrome-extension://${this.id}/panel.html`);
    let panel: Page | undefined;
    for (const candidate of candidates) {
      await this.verifyPage(candidate);
      const nativeWindow = await candidate.evaluate(
        async () => (await chrome.windows.getCurrent()).id,
      );
      if (windowId === undefined || nativeWindow === windowId) {
        panel = candidate;
        break;
      }
    }
    if (!panel) throw new Error("Native side panel target was not attached");
    await expect(panel.locator("#vault-chip")).toHaveAttribute(
      "data-access",
      /^(ready|unavailable)$/,
    );
    return panel;
  }

  async restart(): Promise<void> {
    if (this.borrowedBrowser)
      throw new Error("Cannot restart a borrowed browser context");
    await this.context.close();
    this.attached = [];
    await this.start();
  }

  /** Load a new manifest version over this profile's own unpacked build. */
  async loadNewerBuild(): Promise<{ before: string; after: string }> {
    const manifestPath = path.join(
      this.profile,
      "unpacked-extension",
      "manifest.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const before: string = manifest.version;
    const parts = before.split(".").map(Number);
    parts[parts.length - 1]++;
    const after = parts.join(".");
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, version: after }),
    );
    const previousWorker = this.worker;
    const installer = await this.context.browser()!.newBrowserCDPSession();
    const id = await extensionInstaller(installer, () =>
      this.activateProfile(),
    ).load(path.dirname(manifestPath));
    await installer.detach();
    expect(id).toBe(this.id);
    await expect
      .poll(() => this.context.serviceWorkers().includes(previousWorker))
      .toBe(false);
    // A reloaded MV3 worker may wait for its next event before starting.
    // Wake it from a new extension view while keeping the old chat open.
    const probe = await this.newOwnedPage();
    await expect
      .poll(async () => {
        try {
          await probe.goto(`chrome-extension://${this.id}/options.html`);
          return true;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.includes("ERR_BLOCKED_BY_CLIENT")
          )
            throw error;
          return false;
        }
      })
      .toBe(true);
    await probe.evaluate(() =>
      chrome.runtime.sendMessage({ type: "block-sends" }),
    );
    await expect
      .poll(() =>
        this.context
          .serviceWorkers()
          .some((worker) =>
            worker.url().startsWith(`chrome-extension://${this.id}/`),
          ),
      )
      .toBe(true);
    this.worker = this.context
      .serviceWorkers()
      .find((worker) =>
        worker.url().startsWith(`chrome-extension://${this.id}/`),
      )!;
    await probe.close();
    await expect
      .poll(() =>
        this.worker.evaluate(() => chrome.runtime.getManifest().version),
      )
      .toBe(after);
    return { before, after };
  }

  /**
   * Stop the extension's service worker, as Chrome does after it's been idle
   * for a while. The next event starts a fresh one.
   */
  async stopWorker(): Promise<void> {
    if (this.borrowedBrowser)
      throw new Error("Cannot stop all workers in a borrowed browser context");
    // Mark the running worker, so a fresh one is told apart from it
    await this.worker.evaluate(() =>
      Object.assign(globalThis, { stoppedByTest: true }),
    );
    const page = await this.newOwnedPage();
    await page.goto(`chrome-extension://${this.id}/options.html`);
    const session = await this.context.newCDPSession(page);
    await session.send("ServiceWorker.enable");
    await session.send("ServiceWorker.stopAllWorkers");
    // Playwright may still list a stopped worker, so check none still running
    // holds the mark. The page stays open until then, or the stop may not
    // happen.
    await expect.poll(() => this.markedWorker()).toBe(false);
    await session.detach();
    await page.close();
    // Follow the next worker, started by whatever event comes next
    this.context.once("serviceworker", (worker) => {
      if (worker.url().startsWith(`chrome-extension://${this.id}/`))
        this.worker = worker;
    });
  }

  /** Whether a running extension worker holds the mark `stopWorker` set. */
  private async markedWorker(): Promise<boolean> {
    const marked = await Promise.all(
      this.context
        .serviceWorkers()
        .filter((worker) =>
          worker.url().startsWith(`chrome-extension://${this.id}/`),
        )
        .map((worker) =>
          // A stopped worker may never answer, so give up after a moment
          Promise.race([
            worker
              .evaluate(() => "stoppedByTest" in globalThis)
              .catch(() => false),
            new Promise<boolean>((resolve) =>
              setTimeout(() => resolve(false), 500),
            ),
          ]),
        ),
    );
    return marked.includes(true);
  }

  async stop(traces?: (name: string) => string): Promise<string[]> {
    const paths: string[] = [];
    const failures: unknown[] = [];
    const attempt = async (cleanup: () => Promise<void>) => {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    };
    if (this.context && !this.borrowedBrowser) {
      const contexts = [
        this.context,
        ...this.attached.flatMap((browser) => browser.contexts()),
      ];
      for (const [index, context] of contexts.entries()) {
        const file = traces?.(`trace-${index}.zip`);
        try {
          await context.tracing.stop(file ? { path: file } : {});
          if (file) paths.push(file);
        } catch {
          /* Reloads may have closed a traced target. */
        }
      }
    }
    const browser = this.borrowedBrowser ?? this.context?.browser();
    if (browser)
      await attempt(async () => {
        const installer = await browser.newBrowserCDPSession();
        try {
          await this.installation.remove(
            extensionInstaller(installer, () => this.activateProfile()),
          );
        } finally {
          await installer.detach();
        }
      });
    // Continue releasing test resources even if uninstall or a page close fails.
    for (const page of this.ownedPages)
      if (!page.isClosed()) await attempt(() => page.close());
    this.ownedPages.clear();
    for (const connection of this.attached)
      await attempt(() => connection.close());
    this.attached = [];
    if (this.borrowedBrowser) {
      // Disconnect this CDP client; leave the independently launched sign-in
      // browser and every preexisting user tab open.
      await attempt(() => this.borrowedBrowser!.close());
    } else if (this.context) await attempt(() => this.context.close());
    if (failures.length)
      throw new AggregateError(failures, "Test extension cleanup failed");
    return paths;
  }
}

export const test = base.extend<{
  extension: Extension;
  chat: Page;
  badge: ClosedShadow;
}>({
  extension: async ({ headless }, use, testInfo) => {
    const profile = await mkdtemp(path.join(tmpdir(), "datafog-e2e-"));
    const extension = new Extension(profile, headless);
    try {
      await extension.start();
      testInfo.annotations.push({
        type: "browser",
        description: `Google Chrome ${extension.context.browser()!.version()}`,
      });
      await use(extension);
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus;
      try {
        const traces = await extension.stop(
          failed ? (name) => testInfo.outputPath(name) : undefined,
        );
        for (const file of traces)
          await testInfo.attach(path.basename(file), {
            path: file,
            contentType: "application/zip",
          });
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    }
  },
  chat: async ({ extension }, use) => {
    await use(await extension.newChat());
  },
  badge: async ({ extension, chat }, use) => {
    await use(extension.badge(chat));
  },
});
