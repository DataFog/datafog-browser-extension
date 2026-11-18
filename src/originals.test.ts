// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { hideOriginals, showOriginals, watchAnswers } from "./originals";
import { siteFor } from "./site";
import type { RestoredWithValues } from "./messages";
const VALUES = [{ marker: "[[EMAIL_A]]", original: "<b>jane@example.com</b>" }];
const RESULT: RestoredWithValues = {
  text: "",
  restored: 1,
  unrestored: 0,
  values: VALUES,
};
let stop: (() => void) | undefined;
beforeEach(() => {
  // oxlint-disable-next-line typescript/unbound-method -- called with this below
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    init,
  ) {
    return attach.call(this, { ...init, mode: "open" });
  });
  document.body.innerHTML = "";
});
afterEach(() => {
  stop?.();
  stop = undefined;
  hideOriginals();
  vi.restoreAllMocks();
});
const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
function answer(text: string): HTMLElement {
  const article = document.createElement("article");
  article.innerHTML =
    '<div data-message-author-role="assistant"></div><div data-actions></div>';
  const content = article.querySelector<HTMLElement>(
    "[data-message-author-role]",
  )!;
  content.textContent = text;
  document.body.append(article);
  return content;
}
function toggle(index = 0): HTMLButtonElement {
  return document
    .querySelectorAll("datafog-answer-control")
    .item(index)
    .shadowRoot!.querySelector("button")!;
}
function overlay(): string {
  return Array.from(
    document.querySelectorAll("datafog-original"),
    (host) => host.shadowRoot!.textContent,
  ).join(" ");
}
test("shows adjacent and repeated originals as text without changing any provider nodes", () => {
  const content = answer("[[EMAIL_A]][[EMAIL_A]] and [[UNKNOWN_X]]");
  const node = content.firstChild;
  expect(showOriginals(content, VALUES)).toBe(2);
  expect(content.textContent).toBe("[[EMAIL_A]][[EMAIL_A]] and [[UNKNOWN_X]]");
  expect(content.firstChild).toBe(node);
  expect(overlay()).toContain("<b>jane@example.com</b><b>jane@example.com</b>");
  expect(
    document.querySelector("datafog-original")!.shadowRoot!.querySelector("b"),
  ).toBeNull();
  hideOriginals(content);
  expect(content.firstChild).toBe(node);
  expect(content.style.visibility).toBe("");
});
test("answer visibility is independent and hide performs no reads", async () => {
  const first = answer("[[EMAIL_A]]");
  const second = answer("[[EMAIL_A]]");
  const read = vi.fn(async () => RESULT);
  const watcher = watchAnswers(siteFor("chatgpt.com"), read);
  stop = watcher.dispose;
  await tick();
  toggle(0).click();
  await tick();
  toggle(1).click();
  await tick();
  expect(document.querySelectorAll("datafog-original")).toHaveLength(2);
  const count = read.mock.calls.length;
  toggle(0).click();
  expect(document.querySelectorAll("datafog-original")).toHaveLength(1);
  expect(read).toHaveBeenCalledTimes(count);
  expect(first.style.visibility).toBe("");
  expect(second.style.visibility).toBe("hidden");
});
test("unknown-only answers have no offered reveal and partial answers explain unknown markers", async () => {
  answer("[[EMAIL_A]][[UNKNOWN_X]]");
  answer("[[UNKNOWN_X]]");
  const watcher = watchAnswers(siteFor("chatgpt.com"), async (text) =>
    text.includes("EMAIL")
      ? { ...RESULT, unrestored: 1 }
      : { ...RESULT, values: [], restored: 0, unrestored: 1 },
  );
  stop = watcher.dispose;
  await tick();
  const hosts = document.querySelectorAll<HTMLElement>(
    "datafog-answer-control",
  );
  expect(hosts[0].hidden).toBe(false);
  expect(hosts[1].hidden).toBe(true);
  toggle().click();
  await tick();
  expect(hosts[0].shadowRoot!.textContent).toContain("could not be restored");
  expect(overlay()).toContain("[[UNKNOWN_X]]");
});
test("streaming invalidates a pending read and removes shown plaintext", async () => {
  const content = answer("[[EMAIL_A]]");
  let resolve!: (value: RestoredWithValues) => void;
  let calls = 0;
  const watcher = watchAnswers(siteFor("chatgpt.com"), async () =>
    ++calls === 2
      ? new Promise((done) => {
          resolve = done;
        })
      : RESULT,
  );
  stop = watcher.dispose;
  await tick();
  toggle().click();
  content.textContent = "new [[EMAIL_A]]";
  await tick();
  resolve(RESULT);
  await tick();
  expect(document.querySelectorAll("datafog-original")).toHaveLength(0);
  expect(toggle().textContent).toBe("Show originals");
  toggle().click();
  await tick();
  expect(document.querySelectorAll("datafog-original")).toHaveLength(1);
  content.textContent = "stream finished";
  await tick();
  expect(document.querySelectorAll("datafog-original")).toHaveLength(0);
});
test("redraw and removal never duplicate controls; policy recovery retries failed reads", async () => {
  const content = answer("[[EMAIL_A]]");
  let failed = true;
  const watcher = watchAnswers(siteFor("chatgpt.com"), async () =>
    failed ? { error: "storage_unavailable" } : RESULT,
  );
  stop = watcher.dispose;
  await tick();
  expect(
    document.querySelector<HTMLElement>("datafog-answer-control")!.hidden,
  ).toBe(true);
  failed = false;
  watcher.refresh();
  await tick();
  expect(
    document.querySelector<HTMLElement>("datafog-answer-control")!.hidden,
  ).toBe(false);
  const row = content.parentElement!.querySelector("[data-actions]")!;
  row.replaceChildren();
  await tick();
  expect(document.querySelectorAll("datafog-answer-control")).toHaveLength(1);
  toggle().click();
  await tick();
  content.parentElement!.remove();
  await tick();
  expect(document.querySelectorAll("datafog-original")).toHaveLength(0);
  expect(document.querySelectorAll("datafog-answer-control")).toHaveLength(0);
});

test.each(["display", "visibility", "hidden"])(
  "hiding a connected conversation with %s removes its reveal and invalidates reads",
  async (kind) => {
    const content = answer("[[EMAIL_A]]");
    const conversation = content.parentElement!;
    let delayed = false;
    let resolve!: (value: RestoredWithValues) => void;
    const watcher = watchAnswers(siteFor("chatgpt.com"), async () =>
      delayed
        ? new Promise((done) => {
            resolve = done;
          })
        : RESULT,
    );
    stop = watcher.dispose;
    await tick();
    toggle().click();
    await tick();
    expect(document.querySelectorAll("datafog-original")).toHaveLength(1);
    const hide = () => {
      if (kind === "hidden") conversation.hidden = true;
      else
        conversation.style.setProperty(
          kind,
          kind === "display" ? "none" : "hidden",
        );
    };
    const show = () => {
      conversation.hidden = false;
      conversation.style.removeProperty(kind);
    };
    hide();
    await tick();
    expect(content.isConnected).toBe(true);
    expect(document.querySelectorAll("datafog-original")).toHaveLength(0);
    expect(document.querySelectorAll("datafog-answer-control")).toHaveLength(0);
    show();
    await tick();
    delayed = true;
    toggle().click();
    hide();
    await tick();
    resolve(RESULT);
    await tick();
    expect(document.querySelectorAll("datafog-original")).toHaveLength(0);
    expect(content.textContent).toBe("[[EMAIL_A]]");
  },
);

function turn(withActions: boolean) {
  const container = document.createElement("div");
  container.setAttribute("data-talvt-turn-state", "complete");
  let wrapper = container;
  for (let depth = 0; depth < 9; depth++) {
    const child = document.createElement("div");
    wrapper.append(child);
    wrapper = child;
  }
  wrapper.innerHTML = "<div data-dil-response>[[EMAIL_A]]</div>";
  const userActions = document.createElement("div");
  userActions.className = "flex";
  userActions.innerHTML =
    '<button aria-label="Copy message"></button><button aria-label="Edit message"></button>';
  container.append(userActions);
  if (withActions) {
    const actions = document.createElement("div");
    actions.className = "turn-action-controls";
    actions.innerHTML =
      '<div class="flex"><button aria-label="Copy"></button><button aria-label="Rate response"></button></div>';
    container.append(actions);
  }
  document.body.append(container);
  return container;
}

test("deep ChatGPT Dil responses use their own assistant action row and never a neighboring turn", async () => {
  const first = turn(true);
  const missing = turn(false);
  const second = turn(true);
  const watcher = watchAnswers(siteFor("chatgpt.com"), async () => RESULT);
  stop = watcher.dispose;
  await tick();
  expect(
    first.querySelector(".turn-action-controls .flex datafog-answer-control"),
  ).not.toBeNull();
  expect(
    second.querySelector(".turn-action-controls .flex datafog-answer-control"),
  ).not.toBeNull();
  expect(missing.querySelector("datafog-answer-control")).toBeNull();
  expect(document.querySelectorAll("datafog-answer-control")).toHaveLength(2);
  toggle(0).click();
  await tick();
  expect(
    first.querySelector<HTMLElement>("[data-dil-response]")!.style.visibility,
  ).toBe("hidden");
  expect(
    second.querySelector<HTMLElement>("[data-dil-response]")!.style.visibility,
  ).toBe("");
  expect(first.textContent).toContain("[[EMAIL_A]]");
  expect(document.querySelectorAll("datafog-original")).toHaveLength(1);
});
