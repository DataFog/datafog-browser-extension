import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const build = readFileSync("build.mjs", "utf8");

describe("manifest", () => {
  it("opens the side panel page", () => {
    expect(manifest.permissions).toContain("sidePanel");
    expect(manifest.side_panel.default_path).toBe("panel.html");
  });

  it("ships the panel page and its script", () => {
    expect(build).toContain('"panel.html"');
    expect(build).toContain('"src/panel.ts"');
  });
});
