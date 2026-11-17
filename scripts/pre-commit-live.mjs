/** Git invokes the complete local live suite, without selection arguments. */
import { runLiveTests } from "./run-live-tests.mjs";

try {
  await runLiveTests();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "The local live check failed.",
  );
  console.error("Commit stopped: the complete local live suite must pass.");
  process.exitCode = 1;
}
