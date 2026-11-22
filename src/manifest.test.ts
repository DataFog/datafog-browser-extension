import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { HOSTS } from "./site";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const build = readFileSync("build.mjs", "utf8");

describe("manifest", () => {
  it("runs on exactly the chat sites DataFog has a profile for", () => {
    expect(manifest.content_scripts[0].matches).toEqual(
      HOSTS.map((host) => `https://${host}/*`),
    );
  });

  it("can reach chat tabs that were open before install, and only those", () => {
    expect(manifest.permissions).toContain("scripting");
    expect(manifest.host_permissions).toEqual(
      manifest.content_scripts[0].matches,
    );
  });

  it("ships the welcome page and its script", () => {
    expect(build).toContain('"welcome.html"');
    expect(build).toContain('"src/welcome.ts"');
  });

  it("opens the side panel page", () => {
    expect(manifest.permissions).toContain("sidePanel");
    expect(manifest.side_panel.default_path).toBe("panel.html");
  });

  it("can open the offscreen document that runs Core", () => {
    expect(manifest.permissions).toContain("offscreen");
    expect(build).toContain('"offscreen.html"');
    expect(build).toContain('"src/offscreen.ts"');
  });

  it("ships an icon at every size it declares", () => {
    const icons = [
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
    ];
    expect(icons.length).toBeGreaterThan(0);
    expect(icons.filter((icon) => !existsSync(String(icon)))).toEqual([]);
    expect(build).toContain('"icons"');
  });

  it("ships the panel page and its script", () => {
    expect(build).toContain('"panel.html"');
    expect(build).toContain('"src/panel.ts"');
  });
});
