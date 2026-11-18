import {
  chromium,
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Worker,
} from "@playwright/test";
import { constants } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
  title: string;
  visible: boolean;
  disabled: boolean;
  rect: { x: number; y: number; width: number; height: number };
  /** The top right corner's radius, as computed. */
  radius: string;
}

/** Inspect closed roots through DevTools, preserving production isolation. */
export class ClosedShadow {
  constructor(
    private page: Page,
    private hostSelector: string,
  ) {}

  async state(selector: string): Promise<ShadowState> {
    await this.page
      .locator(this.hostSelector)
      .first()
      .waitFor({ state: "attached" });
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
            text: el.textContent || '', title: el.getAttribute('title') || '',
            visible: el.checkVisibility(), disabled: Boolean(el.disabled),
            rect: {x:r.x,y:r.y,width:r.width,height:r.height},
            radius: getComputedStyle(el).borderTopRightRadius
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
      .poll(async () => (await this.state(selector)).visible)
      .toBe(true);
    const { rect, disabled } = await this.state(selector);
    expect(disabled, `${selector} should be enabled`).toBe(false);
    // A real mouse click carries the user gesture needed to open a side panel.
    await this.page.mouse.click(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
  }
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
    </div></fieldset><output id="sent-count">0</output></main>
    <script>
      const sent=document.querySelector('#sent-count');
      const send=()=>{sent.textContent=String(Number(sent.textContent)+1)};
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
    </input-area-v2><output id="sent-count">0</output></main>
    <script>
      const sent=document.querySelector('#sent-count');
      const send=()=>{sent.textContent=String(Number(sent.textContent)+1)};
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
    </form><output id="sent-count">0</output></main>
    <script>
      const form=document.querySelector('form');
      const sent=document.querySelector('#sent-count');
      form.addEventListener('submit', e=>{e.preventDefault(); sent.textContent=String(Number(sent.textContent)+1)});
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
    </div><output id="sent-count">0</output></main>
    <script>
      const sent=document.querySelector('#sent-count');
      const send=()=>{sent.textContent=String(Number(sent.textContent)+1)};
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
    </form><output id="sent-count">0</output></main>
    <script>
      const form=document.querySelector('form');
      const sent=document.querySelector('#sent-count');
      form.addEventListener('submit', e=>{e.preventDefault(); sent.textContent=String(Number(sent.textContent)+1)});
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

  constructor(
    private profile: string,
    private headless: boolean,
    private config: {
      live?: boolean;
      storageState?: string;
      cdpEndpoint?: string;
      replaceHelperExtension?: boolean;
    } = {},
  ) {}

  async start(): Promise<void> {
    const extensionPath = path.join(this.profile, "unpacked-extension");
    if (!this.installed) {
      await cp(path.resolve("dist"), extensionPath, {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
      });
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
      this.context = this.borrowedBrowser.contexts()[0];
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
    } else if (!this.authLoaded && !this.borrowedBrowser) {
      if (this.config.storageState)
        await this.context.setStorageState(this.config.storageState);
      this.authLoaded = true;
    }
    const installer = await this.context.browser()!.newBrowserCDPSession();
    if (this.borrowedBrowser) {
      // Replace only the helper's unpacked DataFog build in the dedicated
      // test profile, avoiding two content scripts in each ChatGPT tab.
      const { extensions } = await installer.send("Extensions.getExtensions");
      for (const extension of extensions) {
        if (
          path.resolve(extension.path) === path.resolve("dist") &&
          this.config.replaceHelperExtension
        )
          await installer.send("Extensions.uninstall", { id: extension.id });
        else if (extension.enabled && extension.name.startsWith("DataFog"))
          throw new Error(
            "This browser already has DataFog installed. Use the dedicated sign-in profile so the live suite does not change an existing vault.",
          );
      }
    }
    const { id } = await installer.send("Extensions.loadUnpacked", {
      path: extensionPath,
    });
    await installer.detach();
    this.id = id;
    const isExtensionWorker = (worker: Worker) =>
      worker.url().startsWith(`chrome-extension://${this.id}/`);
    this.worker =
      this.context.serviceWorkers().find(isExtensionWorker) ??
      (await this.context.waitForEvent("serviceworker", {
        predicate: isExtensionWorker,
      }));
    if (!this.borrowedBrowser) {
      this.debugPort = (
        await readFile(path.join(this.profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
    }
  }

  async newChat(options: ChatOptions = {}): Promise<Page> {
    const origin = ORIGINS[options.site ?? "chatgpt"];
    const url = new URL(options.path ?? "/", origin).href;
    this.pages.set(url, options);
    const page = await this.context.newPage();
    this.ownedPages.add(page);
    this.currentChat = page;
    await page.goto(url);
    await page.locator("datafog-tab").waitFor({ state: "attached" });
    return page;
  }

  badge(page: Page): ClosedShadow {
    return this.shadow(page, "datafog-badge");
  }

  shadow(page: Page, selector: string): ClosedShadow {
    return new ClosedShadow(page, selector);
  }

  async options(): Promise<Page> {
    const page = await this.context.newPage();
    this.ownedPages.add(page);
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
    await this.shadow(chat, "datafog-tab").click("button");
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
    const candidates = context
      .pages()
      .filter((p) => p.url() === `chrome-extension://${this.id}/panel.html`);
    let panel: Page | undefined;
    for (const candidate of candidates) {
      const nativeWindow = await candidate.evaluate(
        async () => (await chrome.windows.getCurrent()).id,
      );
      if (windowId === undefined || nativeWindow === windowId) {
        panel = candidate;
        break;
      }
    }
    if (!panel) throw new Error("Native side panel target was not attached");
    await expect(
      panel
        .locator("#create, #unlock, #unlocked")
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    return panel;
  }

  async restart(): Promise<void> {
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
    const { id } = await installer.send("Extensions.loadUnpacked", {
      path: path.dirname(manifestPath),
    });
    await installer.detach();
    expect(id).toBe(this.id);
    await expect
      .poll(() => this.context.serviceWorkers().includes(previousWorker))
      .toBe(false);
    // A reloaded MV3 worker may wait for its next event before starting.
    // Wake it from a new extension view while keeping the old chat open.
    const probe = await this.context.newPage();
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
    // Mark the running worker, so a fresh one is told apart from it
    await this.worker.evaluate(() =>
      Object.assign(globalThis, { stoppedByTest: true }),
    );
    const page = await this.context.newPage();
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
    if (!this.context) return [];
    if (this.borrowedBrowser) {
      if (this.id) {
        const installer = await this.borrowedBrowser.newBrowserCDPSession();
        try {
          await installer.send("Extensions.uninstall", { id: this.id });
        } finally {
          await installer.detach();
        }
      }
      for (const page of this.ownedPages)
        if (!page.isClosed()) await page.close();
      for (const connection of this.attached) await connection.close();
      // Closing a connectOverCDP connection disconnects this client; the
      // independently launched sign-in browser stays open for the user.
      await this.borrowedBrowser.close();
      return [];
    }
    const paths: string[] = [];
    const contexts = [
      this.context,
      ...this.attached.flatMap((b) => b.contexts()),
    ];
    for (const [i, context] of contexts.entries()) {
      const file = traces?.(`trace-${i}.zip`);
      try {
        await context.tracing.stop(file ? { path: file } : {});
        if (file) paths.push(file);
      } catch {
        /* A restart or runtime reload may have closed this target. */
      }
    }
    await this.context.close();
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
      const traces = await extension.stop(
        failed ? (name) => testInfo.outputPath(name) : undefined,
      );
      for (const file of traces)
        await testInfo.attach(path.basename(file), {
          path: file,
          contentType: "application/zip",
        });
      await rm(profile, { recursive: true, force: true });
    }
  },
  chat: async ({ extension }, use) => {
    await use(await extension.newChat());
  },
  badge: async ({ extension, chat }, use) => {
    await use(extension.badge(chat));
  },
});
