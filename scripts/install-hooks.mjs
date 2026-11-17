/** Install this repository's hook without replacing another hook setup. */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

try {
  const hooks = path.join(root, ".githooks");
  const configured = spawnSync("git", ["config", "--get", "core.hooksPath"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (configured.error) throw configured.error;
  if (configured.status !== 0 && configured.status !== 1)
    throw new Error("Could not inspect the existing Git hook configuration.");
  const current = configured.stdout.trim();
  if (current && path.resolve(root, current) !== hooks)
    throw new Error(
      `Git already uses a custom hook directory (${current}). Integrate the live pre-commit check there instead of replacing it.`,
    );

  if (!current) {
    const existingHooks = path.resolve(
      root,
      git(["rev-parse", "--git-path", "hooks"]),
    );
    let active = [];
    try {
      active = readdirSync(existingHooks).filter((name) => {
        if (name.startsWith(".") || name.endsWith(".sample")) return false;
        const info = lstatSync(path.join(existingHooks, name));
        return (
          (info.isFile() || info.isSymbolicLink()) &&
          (process.platform === "win32" || Boolean(info.mode & 0o111))
        );
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (active.length)
      throw new Error(
        `Existing Git hooks would be bypassed (${active.join(", ")}). Integrate the live pre-commit check with those hooks first.`,
      );
  }

  chmodSync(path.join(hooks, "pre-commit"), 0o755);
  git(["config", "--local", "core.hooksPath", ".githooks"]);
  console.log(
    "Installed the local live-test pre-commit hook for this repository.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Hook installation failed.",
  );
  process.exitCode = 1;
}
