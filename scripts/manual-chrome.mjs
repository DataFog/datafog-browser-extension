/** Launch installed Chrome for human sign-in, without an automation connection. */
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

export async function chromeExecutable(
  platform = process.platform,
  env = process.env,
) {
  const candidates = env.CHROME_EXECUTABLE_PATH
    ? [env.CHROME_EXECUTABLE_PATH]
    : platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : platform === "win32"
        ? [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
            .filter(Boolean)
            .map((base) =>
              path.join(base, "Google/Chrome/Application/chrome.exe"),
            )
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/opt/google/chrome/chrome",
          ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* Try next install location. */
    }
  }
  throw new Error(
    "Install Google Chrome or set CHROME_EXECUTABLE_PATH to its executable.",
  );
}

export function launchManualChrome(executable, profile, launch = spawn) {
  return launch(
    executable,
    [
      `--user-data-dir=${path.resolve(profile)}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--enable-unsafe-extension-debugging",
      "https://chatgpt.com/",
    ],
    { stdio: "ignore" },
  );
}
