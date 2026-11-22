/** One local, silent walkthrough clip at a time; motion is always optional. */
export function welcomeMedia(
  root: HTMLElement,
  reducedMotion: Pick<
    MediaQueryList,
    "matches" | "addEventListener" | "removeEventListener"
  > = window.matchMedia("(prefers-reduced-motion: reduce)"),
): { setVisible: (visible: boolean) => void; dispose: () => void } {
  const tabs = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-demo-tab]"),
  );
  const panels = Array.from(
    root.querySelectorAll<HTMLElement>("[data-demo-panel]"),
  );
  const videos = panels.map((panel) => panel.querySelector("video")!);
  const playback = root.querySelector<HTMLButtonElement>("#demo-playback")!;
  const status = root.querySelector<HTMLElement>("#demo-status")!;
  let selected = 0;
  let visible = false;
  let request = 0;
  let desiredVideo: HTMLVideoElement | null = null;

  function syncPlayback(): void {
    const playing = !videos[selected].paused && !videos[selected].ended;
    playback.textContent = playing ? "Pause demo" : "Play demo";
    playback.setAttribute("aria-controls", videos[selected].id);
    playback.setAttribute(
      "aria-label",
      `${playing ? "Pause" : "Play"} ${tabs[selected].textContent.trim()} demo`,
    );
  }
  function pauseAll(): void {
    request++;
    desiredVideo = null;
    for (const video of videos) video.pause();
    syncPlayback();
  }
  async function play(): Promise<void> {
    if (!visible || document.hidden) return;
    const mine = ++request;
    const video = videos[selected];
    desiredVideo = video;
    status.textContent = "";
    video.muted = true;
    try {
      await video.play();
      if (
        desiredVideo !== video ||
        video !== videos[selected] ||
        !visible ||
        document.hidden
      )
        video.pause();
    } catch {
      if (mine === request)
        status.textContent =
          "The demo couldn't play. You can still follow the preview and caption.";
    }
    syncPlayback();
  }
  function select(next: number): void {
    if (next === selected) return;
    pauseAll();
    selected = next;
    tabs.forEach((tab, index) => {
      tab.setAttribute("aria-selected", String(index === selected));
      tab.tabIndex = index === selected ? 0 : -1;
      panels[index].hidden = index !== selected;
    });
    status.textContent = "";
    syncPlayback();
    if (!reducedMotion.matches) void play();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index));
    tab.addEventListener("keydown", (event) => {
      let next: number;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft")
        next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      select(next);
      tabs[next].focus();
    });
  });
  for (const video of videos) {
    video.muted = true;
    video.loop = false;
    video.addEventListener("play", syncPlayback);
    video.addEventListener("pause", syncPlayback);
    video.addEventListener("ended", syncPlayback);
  }
  playback.addEventListener("click", () => {
    const video = videos[selected];
    if (!video.paused && !video.ended) pauseAll();
    else void play();
  });
  const visibilityChanged = () => {
    if (document.hidden) pauseAll();
  };
  const motionChanged = () => {
    if (!reducedMotion.matches) return;
    pauseAll();
    // Reset the media to its poster, including when the preference changes
    // while a clip is running. Explicit Play remains available.
    for (const video of videos) video.load();
  };
  document.addEventListener("visibilitychange", visibilityChanged);
  reducedMotion.addEventListener("change", motionChanged);
  syncPlayback();
  return {
    setVisible: (next) => {
      if (next === visible) return;
      visible = next;
      if (!visible) pauseAll();
      else if (!reducedMotion.matches) void play();
    },
    dispose: () => {
      visible = false;
      pauseAll();
      document.removeEventListener("visibilitychange", visibilityChanged);
      reducedMotion.removeEventListener("change", motionChanged);
    },
  };
}
