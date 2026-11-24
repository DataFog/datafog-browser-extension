// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { welcomeMedia } from "./welcome-media";
const BODY = readFileSync("welcome.html", "utf8")
  .split("<body>")[1]
  .split("<script")[0];
let dispose: (() => void) | undefined;
beforeEach(() => {
  document.body.innerHTML = BODY;
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
});
function setup(reduced = false) {
  const root = document.getElementById("walkthrough")!;
  const videos = Array.from(root.querySelectorAll("video"));
  const paused = videos.map(() => true);
  const loads = videos.map((video) =>
    vi.spyOn(video, "load").mockImplementation(() => {}),
  );
  const plays = videos.map((video, index) => {
    vi.spyOn(video, "paused", "get").mockImplementation(() => paused[index]);
    vi.spyOn(video, "pause").mockImplementation(() => {
      paused[index] = true;
      video.dispatchEvent(new Event("pause"));
    });
    return vi.spyOn(video, "play").mockImplementation(async () => {
      paused[index] = false;
      video.dispatchEvent(new Event("play"));
    });
  });
  let motionChange: () => void = vi.fn();
  const preference = {
    matches: reduced,
    addEventListener: vi.fn((_event: string, listener: () => void) => {
      motionChange = listener;
    }),
    removeEventListener: vi.fn(),
  };
  // Only the media-query members used by the controller are relevant here.
  const controller = welcomeMedia(root, preference);
  dispose = controller.dispose;
  return {
    root,
    videos,
    plays,
    paused,
    loads,
    controller,
    preference,
    motionChange: () => motionChange(),
    button: root.querySelector<HTMLButtonElement>("#demo-playback")!,
    tabs: Array.from(
      root.querySelectorAll<HTMLButtonElement>("[data-demo-slide]"),
    ),
  };
}

test("welcome clips are local silent demonstrations with captions and looping and no autoplay markup", () => {
  const { videos, root } = setup();
  expect(videos).toHaveLength(3);
  videos.forEach((video) => {
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.getAttribute("poster")).toMatch(
      /^assets\/onboarding\/.+\.png$/,
    );
    expect(video.querySelector("source")!.getAttribute("src")).toMatch(
      /^assets\/onboarding\/.+\.webm$/,
    );
    expect(video.getAttribute("aria-describedby")).toBeTruthy();
  });
  expect(root.textContent).toContain("Mask sensitive details before you send.");
  expect(root.textContent).toContain("The AI keeps the placeholders.");
  expect(root.textContent).toContain("Copy your answer with details restored.");
});
test("only the selected visible clip starts once and explicit pause is respected", async () => {
  const state = setup();
  expect(state.plays[0]).not.toHaveBeenCalled();
  state.controller.setVisible(true);
  await Promise.resolve();
  expect(state.plays[0]).toHaveBeenCalledOnce();
  expect(state.button.textContent).toBe("Pause demonstration");
  state.button.click();
  expect(state.paused[0]).toBe(true);
  expect(state.button.textContent).toBe("Play demonstration");
  state.controller.setVisible(true);
  expect(state.plays[0]).toHaveBeenCalledOnce();
  state.tabs[1].click();
  await Promise.resolve();
  expect(state.paused[0]).toBe(true);
  expect(state.plays[1]).toHaveBeenCalledOnce();
  expect(state.plays[2]).not.toHaveBeenCalled();
  expect(state.button.getAttribute("aria-controls")).toBe(
    "demo-originals-video",
  );
  state.controller.setVisible(false);
  expect(state.paused.every(Boolean)).toBe(true);
});
test("reduced motion starts with posters and allows only explicit playback", async () => {
  const state = setup(true);
  state.controller.setVisible(true);
  state.tabs[1].click();
  expect(state.plays.every((play) => play.mock.calls.length === 0)).toBe(true);
  state.button.click();
  await Promise.resolve();
  expect(state.plays[1]).toHaveBeenCalledOnce();
  expect(state.button.textContent).toBe("Pause demonstration");
  state.button.click();
  expect(state.paused[1]).toBe(true);
});
test("turning reduced motion on pauses playback and restores poster state", async () => {
  const state = setup();
  state.controller.setVisible(true);
  await Promise.resolve();
  state.preference.matches = true;
  state.motionChange();
  expect(state.paused.every(Boolean)).toBe(true);
  state.loads.forEach((load) => expect(load).toHaveBeenCalledOnce());
  state.preference.matches = false;
  state.motionChange();
  expect(state.plays[0]).toHaveBeenCalledOnce();
});
test("keyboard slide dots select one clip and hidden pages stop playback", async () => {
  const state = setup();
  state.controller.setVisible(true);
  state.tabs[0].focus();
  state.tabs[0].dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    }),
  );
  await Promise.resolve();
  expect(document.activeElement).toBe(state.tabs[1]);
  expect(state.tabs[1].getAttribute("aria-current")).toBe("true");
  expect(state.tabs[0].tabIndex).toBe(-1);
  expect(
    state.root.querySelector<HTMLElement>('[data-demo-panel="replace"]')!
      .hidden,
  ).toBe(true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(state.paused.every(Boolean)).toBe(true);
});
test("a late play promise cannot restart a hidden clip and failures keep readable fallback", async () => {
  const state = setup();
  let finish!: () => void;
  state.plays[0].mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  state.controller.setVisible(true);
  state.tabs[1].click();
  finish();
  await Promise.resolve();
  expect(state.paused[0]).toBe(true);
  state.plays[1].mockRejectedValueOnce(new Error("media unavailable"));
  state.button.click();
  state.button.click();
  await Promise.resolve();
  expect(state.root.querySelector("#demo-status")!.textContent).toContain(
    "preview and caption",
  );
  expect(state.root.querySelector("figcaption")!.textContent).toContain(
    "Mask sensitive",
  );
});

test("a late earlier play does not cancel a newer explicit play of the same clip", async () => {
  const state = setup();
  let finish!: () => void;
  state.plays[0].mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        state.paused[0] = false;
        finish = resolve;
      }),
  );
  state.controller.setVisible(true);
  state.button.click();
  expect(state.paused[0]).toBe(true);
  state.button.click();
  await Promise.resolve();
  expect(state.paused[0]).toBe(false);
  finish();
  await Promise.resolve();
  expect(state.paused[0]).toBe(false);
  expect(state.button.textContent).toBe("Pause demonstration");
});

test("arrows wrap manually while looping never advances the slide", async () => {
  const state = setup();
  state.controller.setVisible(true);
  state.root.querySelector<HTMLButtonElement>("#demo-prev")!.click();
  await Promise.resolve();
  expect(state.tabs[2].getAttribute("aria-current")).toBe("true");
  expect(state.root.querySelector("#demo-position")!.textContent).toBe("3 / 3");
  expect(state.paused[0]).toBe(true);
  state.videos[2].dispatchEvent(new Event("ended"));
  expect(state.tabs[2].getAttribute("aria-current")).toBe("true");
  state.root.querySelector<HTMLButtonElement>("#demo-next")!.click();
  expect(state.tabs[0].getAttribute("aria-current")).toBe("true");
  expect(state.root.querySelector("#demo-position")!.textContent).toBe("1 / 3");
  expect(state.root.querySelectorAll("figcaption.sr")).toHaveLength(3);
  expect(state.root.querySelector('[role="tab"]')).toBeNull();
  expect(state.button.querySelector("svg")).not.toBeNull();
  expect(state.button.querySelector(".sr")!.textContent).toBe(
    "Pause demonstration",
  );
});
