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

test("revealed values carry a focusable token cue while provider text and nodes remain unchanged", () => {
  const content = answer("before [[EMAIL_A]] after");
  const originalNode = content.firstChild;
  showOriginals(content, VALUES);
  const cue = document
    .querySelector("datafog-original")!
    .shadowRoot!.querySelector<HTMLElement>(".restored-value")!;
  expect(cue.textContent).toBe(VALUES[0].original);
  expect(cue.title).toContain("[[EMAIL_A]]");
  expect(cue.tabIndex).toBe(0);
  expect(cue.style.pointerEvents).toBe("auto");
  expect(cue.style.textDecoration).toContain("dotted");
  expect(content.firstChild).toBe(originalNode);
  expect(content.textContent).toBe("before [[EMAIL_A]] after");
});
function copyButton(): HTMLButtonElement {
  return document
    .querySelector("datafog-answer-control")!
    .shadowRoot!.querySelector<HTMLButtonElement>(".copy-originals")!;
}
test("explicit copy restores only its answer and explains unknown markers; native copy stays untouched", async () => {
  const content = answer("[[EMAIL_A]] [[UNKNOWN_X]]");
  const native = document.createElement("button");
  native.textContent = "Copy";
  content.parentElement!.querySelector("[data-actions]")!.append(native);
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const watcher = watchAnswers(siteFor("chatgpt.com"), async () => ({
    ...RESULT,
    text: "jane@example.com [[UNKNOWN_X]]",
    unrestored: 1,
  }));
  stop = watcher.dispose;
  await tick();
  native.click();
  expect(write).not.toHaveBeenCalled();
  copyButton().click();
  await tick();
  expect(write).toHaveBeenCalledWith("jane@example.com [[UNKNOWN_X]]");
  expect(
    document.querySelector("datafog-answer-control")!.shadowRoot!.textContent,
  ).toContain("Unavailable placeholders remain as tokens");
  expect(content.textContent).toBe("[[EMAIL_A]] [[UNKNOWN_X]]");
});
test.each(["streaming", "forgotten", "removed"])(
  "pending original copy does not write clipboard after answer is %s",
  async (invalidation) => {
    const content = answer("[[EMAIL_A]]");
    let finish!: (value: RestoredWithValues) => void;
    let count = 0;
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    const watcher = watchAnswers(siteFor("chatgpt.com"), async () =>
      ++count === 2
        ? new Promise((done) => {
            finish = done;
          })
        : RESULT,
    );
    stop = watcher.dispose;
    await tick();
    copyButton().click();
    if (invalidation === "streaming") content.textContent = "new [[EMAIL_A]]";
    if (invalidation === "forgotten") watcher.refresh();
    if (invalidation === "removed") content.parentElement!.remove();
    await tick();
    finish({ ...RESULT, text: "jane@example.com" });
    await tick();
    expect(write).not.toHaveBeenCalled();
  },
);

test("copy failure is visible and retry reads current originals again", async () => {
  answer("[[EMAIL_A]]");
  const write = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockRejectedValueOnce(new Error("denied"))
    .mockResolvedValue(undefined);
  const read = vi.fn(async () => ({ ...RESULT, text: "jane@example.com" }));
  const watcher = watchAnswers(siteFor("chatgpt.com"), read);
  stop = watcher.dispose;
  await tick();
  copyButton().click();
  await tick();
  expect(
    document.querySelector("datafog-answer-control")!.shadowRoot!.textContent,
  ).toContain("Couldn't copy originals");
  expect(copyButton().disabled).toBe(false);
  copyButton().click();
  await tick();
  expect(write).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenCalledTimes(3);
  expect(
    document.querySelector("datafog-answer-control")!.shadowRoot!.textContent,
  ).toContain("Copied with originals");
});

test("shown originals track provider palette changes in both directions without editing provider text", async () => {
  const content = answer("[[EMAIL_A]]");
  const node = content.firstChild;
  content.style.color = "rgb(14, 19, 22)";
  const watcher = watchAnswers(siteFor("chatgpt.com"), async () => RESULT);
  stop = watcher.dispose;
  await tick();
  toggle().click();
  await tick();
  const color = () =>
    content.ownerDocument
      .querySelector("datafog-original")!
      .shadowRoot!.firstElementChild!.getAttribute("style");
  expect(color()).toContain("color: rgb(14, 19, 22)");
  content.style.color = "rgb(238, 240, 239)";
  await tick();
  expect(color()).toContain("color: rgb(238, 240, 239)");
  expect(toggle().textContent).toBe("Show tokens");
  content.style.color = "rgb(14, 19, 22)";
  await tick();
  expect(color()).toContain("color: rgb(14, 19, 22)");
  expect(content.firstChild).toBe(node);
  expect(content.textContent).toBe("[[EMAIL_A]]");
});

test("only explicitly revealed value spans fade; theme refresh does not replay motion", async () => {
  const content = answer("Known [[EMAIL_A]] and unknown [[UNKNOWN_X]]");
  content.style.color = "rgb(14, 19, 22)";
  const watcher = watchAnswers(siteFor("chatgpt.com"), async () => RESULT);
  stop = watcher.dispose;
  await tick();
  toggle().click();
  await tick();
  let root = document.querySelector("datafog-original")!.shadowRoot!;
  const cue = root.querySelector<HTMLElement>(".restored-value")!;
  expect(cue.classList.contains("revealing")).toBe(true);
  expect(getComputedStyle(cue).animationName).toBe("original-in");
  expect(getComputedStyle(cue).animationDuration).toBe("0.14s");
  expect(root.querySelectorAll(".revealing")).toHaveLength(1);
  expect(root.querySelector("style")!.textContent).not.toContain("transform");
  content.style.color = "rgb(238, 240, 239)";
  await tick();
  root = document.querySelector("datafog-original")!.shadowRoot!;
  expect(root.querySelector(".revealing")).toBeNull();
  expect(content.textContent).toBe(
    "Known [[EMAIL_A]] and unknown [[UNKNOWN_X]]",
  );
  toggle().click();
  expect(document.querySelector("datafog-original")).toBeNull();
});
