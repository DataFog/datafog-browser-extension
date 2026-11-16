import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
} from "@playwright/test/reporter";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { arch, hostname, platform, release } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

type Category = "passed" | "failed" | "skipped" | "flaky" | "notRun";

/** A local receipt contains test outcomes and source identity, never session data. */
export default class ReceiptReporter implements Reporter {
  private tests: TestCase[] = [];
  private globalErrors = 0;
  private outputDirectory: string;

  constructor(options: { outputDirectory?: string } = {}) {
    this.outputDirectory =
      options.outputDirectory ?? path.join(repository, ".playwright");
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.tests = suite.allTests();
  }

  onError(): void {
    this.globalErrors++;
  }

  async onEnd(
    result: FullResult,
  ): Promise<{ status: FullResult["status"] } | void> {
    try {
      return this.writeReceipt(result);
    } catch {
      // Playwright otherwise swallows reporter errors and can return success.
      console.error(
        "The local live-test receipt could not be written. This run is not verified.",
      );
      return { status: "failed" };
    }
  }

  private writeReceipt(
    result: FullResult,
  ): { status: FullResult["status"] } | void {
    const runId = process.env.LIVE_TEST_RUN_ID ?? randomUUID();
    const workingTreeFingerprint =
      process.env.LIVE_TEST_CODE_FINGERPRINT ?? null;
    const commitBase = process.env.LIVE_TEST_COMMIT_BASE ?? null;
    const stagedTree = process.env.LIVE_TEST_STAGED_TREE ?? null;
    let endingWorkingTreeFingerprint: string | null = null;
    try {
      endingWorkingTreeFingerprint = execFileSync(
        process.execPath,
        [path.join(repository, "scripts/run-live-tests.mjs"), "--fingerprint"],
        {
          cwd: repository,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ).trim();
    } catch {
      // The receipt must not claim source verification when the runner is absent.
    }
    const fingerprintPattern = /^sha256:[a-f0-9]{64}$/;
    const sourceUnchanged = Boolean(
      workingTreeFingerprint &&
      fingerprintPattern.test(workingTreeFingerprint) &&
      endingWorkingTreeFingerprint === workingTreeFingerprint,
    );
    const localExecution = !process.env.CI || process.env.CI === "false";
    const argumentsValue: unknown = JSON.parse(
      process.env.LIVE_TEST_ARGUMENTS ?? "[]",
    );
    const argumentsUsed =
      Array.isArray(argumentsValue) &&
      argumentsValue.every((item) => typeof item === "string")
        ? argumentsValue
        : [];

    const counts: Record<Category, number> & { expected: number } = {
      expected: this.tests.length,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      notRun: 0,
    };
    const browserVersions = new Set<string>();
    const tests = this.tests.map((test) => {
      const latest = test.results.at(-1);
      const browser =
        latest?.annotations.find(
          (annotation) =>
            annotation.type === "browser" &&
            annotation.description?.includes("Google Chrome"),
        )?.description ?? null;
      if (browser) browserVersions.add(browser);
      let category: Category;
      if (test.expectedStatus === "skipped" || latest?.status === "skipped")
        category = "skipped";
      else if (!latest) category = "notRun";
      else if (test.outcome() === "flaky") category = "flaky";
      else if (
        test.expectedStatus === "passed" &&
        latest.status === "passed" &&
        test.results.every((attempt) => attempt.status === "passed")
      )
        category = "passed";
      else category = "failed";
      counts[category]++;
      return {
        title: test.titlePath().filter(Boolean).join(" › "),
        status: latest?.status ?? "notRun",
        category,
        expectedStatus: test.expectedStatus,
        browser,
        durationMs: test.results.reduce(
          (total, attempt) => total + attempt.duration,
          0,
        ),
        attempts: test.results.map((attempt) => ({
          retry: attempt.retry,
          status: attempt.status,
          durationMs: attempt.duration,
        })),
      };
    });
    const allTestsPassed =
      result.status === "passed" &&
      counts.expected > 0 &&
      counts.passed === counts.expected &&
      this.globalErrors === 0;
    const completeBrowserEvidence =
      tests.length > 0 && tests.every((test) => test.browser !== null);
    const reasons: string[] = [];
    if (!allTestsPassed)
      reasons.push(
        "Every selected live test must pass with no skipped, flaky or unrun tests.",
      );
    if (!localExecution)
      reasons.push(
        "This process reports CI execution, so it is not a verified local run.",
      );
    if (!workingTreeFingerprint || !commitBase || !stagedTree)
      reasons.push(
        "Source provenance is missing. Run npm run test:e2e:live through the local runner.",
      );
    if (!sourceUnchanged)
      reasons.push(
        "The tested working-tree fingerprint could not be confirmed unchanged.",
      );
    if (!completeBrowserEvidence)
      reasons.push("Google Chrome execution was not recorded for every test.");
    const provenanceVerified =
      localExecution &&
      sourceUnchanged &&
      Boolean(commitBase && stagedTree) &&
      completeBrowserEvidence;
    const status =
      allTestsPassed && provenanceVerified
        ? "PASS"
        : allTestsPassed
          ? "UNVERIFIED"
          : "FAIL";
    const receipt = {
      schemaVersion: 1,
      runId,
      status,
      suite: "live-logged-in-chatgpt",
      target: "https://chatgpt.com",
      localExecution,
      startedAt: result.startTime.toISOString(),
      finishedAt: new Date(
        result.startTime.getTime() + result.duration,
      ).toISOString(),
      durationMs: result.duration,
      host: {
        name: hostname(),
        platform: platform(),
        release: release(),
        arch: arch(),
        node: process.version,
      },
      browserVersions: [...browserVersions],
      source: {
        workingTreeFingerprint,
        endingWorkingTreeFingerprint,
        unchanged: sourceUnchanged,
        commitBase,
        stagedTree,
      },
      selection: {
        fullSuite:
          process.env.LIVE_TEST_SCOPE === "full" &&
          argumentsUsed.every((argument) => argument === "--headed"),
        arguments: argumentsUsed,
      },
      runnerStatus: result.status,
      counts,
      globalErrors: this.globalErrors,
      reasons,
      tests,
    };
    const json = `${JSON.stringify(receipt, null, 2)}\n`;
    const receiptHash = createHash("sha256").update(json).digest("hex");
    const jsonPath = path.join(this.outputDirectory, "live-receipt.json");
    const textPath = path.join(this.outputDirectory, "live-receipt.txt");
    const lines = [
      "LOCAL LIVE TEST RECEIPT",
      `Result: ${status}`,
      `Run: ${runId}`,
      `Started (UTC): ${receipt.startedAt}`,
      `Finished (UTC): ${receipt.finishedAt}`,
      `Host: ${receipt.host.name} (${receipt.host.platform} ${receipt.host.arch})`,
      `Browser: ${receipt.browserVersions.join(", ") || "not recorded"}`,
      `Scope: ${receipt.selection.fullSuite ? "full live suite" : "selected live tests"} (${counts.expected} tests)`,
      `Results: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped, ${counts.flaky} flaky, ${counts.notRun} not run`,
      `Tested working tree: ${workingTreeFingerprint ?? "not recorded"}`,
      `Source unchanged through completion: ${sourceUnchanged ? "yes" : "not verified"}`,
      `Commit base: ${commitBase ?? "not recorded"}`,
      `Staged index tree: ${stagedTree ?? "not recorded"} (the working tree was tested)`,
      ...tests.map(
        (test) =>
          `${test.category === "passed" ? "PASS" : test.category.toUpperCase()} ${test.title} (${test.durationMs} ms)`,
      ),
      ...reasons.map((reason) => `Unverified: ${reason}`),
      `Receipt SHA-256: ${receiptHash}`,
      `JSON: ${jsonPath}`,
      `Text: ${textPath}`,
    ];
    const text = `${lines.join("\n")}\n`;
    mkdirSync(this.outputDirectory, { recursive: true, mode: 0o700 });
    chmodSync(this.outputDirectory, 0o700);
    writeFileSync(jsonPath, json, { mode: 0o600 });
    chmodSync(jsonPath, 0o600);
    writeFileSync(textPath, text, { mode: 0o600 });
    chmodSync(textPath, 0o600);
    console.log(`\n${text}`);
    if (status !== "PASS")
      return { status: result.status === "passed" ? "failed" : result.status };
  }
}
