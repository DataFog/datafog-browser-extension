/**
 * The model scanner opens Core's session when needed, one scan at a time.
 */

import type { Finding, ScanConfig } from "@datafog/wasm";
import { beforeEach, expect, test, vi } from "vitest";

import { scanRules } from "./detect";
import { ModelScanner, needsModel, type ModelSession } from "./model";

vi.mock("./detect", () => ({
  scanRules: vi.fn(async () => []),
  scanConfig: (entities: string[], deny: string[] = []) => ({
    entities,
    detect_uuid: true,
    ...(deny.length > 0 && { deny }),
  }),
}));

const RANGE = { start: 0, end: 3 };
const NAME: Finding = {
  entityType: "PERSON",
  matchedText: "Ann",
  byteRange: RANGE,
  codepointRange: RANGE,
  utf16Range: RANGE,
  detectorName: "datafog-core/model/datafog/PERSON",
};

/** A session that records its scans; they finish when told to. */
class FakeSession implements ModelSession {
  status = "ready";
  closed = 0;
  scans: string[] = [];
  configs: ScanConfig[] = [];
  private finish: (() => void)[] = [];

  async scan(
    text: string,
    config: ScanConfig,
  ): Promise<{ findings: Finding[] }> {
    this.scans.push(text);
    this.configs.push(config);
    await new Promise<void>((resolve) => this.finish.push(resolve));
    return { findings: [NAME] };
  }

  /** Finish the oldest scan still running. */
  next(): void {
    this.finish.shift()?.();
  }

  close(): void {
    this.closed++;
    this.status = "closed";
  }
}

let sessions: FakeSession[];
let scanner: ModelScanner;

beforeEach(() => {
  sessions = [];
  scanner = new ModelScanner(async () => {
    const session = new FakeSession();
    sessions.push(session);
    return session;
  });
});

/**
 * Let pending promise callbacks run.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("needs the model only for names and addresses", () => {
  expect(needsModel(["EMAIL", "PERSON"])).toBe(true);
  expect(needsModel(["ADDRESS"])).toBe(true);
  expect(needsModel(["EMAIL", "SSN"])).toBe(false);
});

test("uses the rules, with no session, when the model isn't needed", async () => {
  await scanner.scan("a@b.co", ["EMAIL"]);
  expect(scanRules).toHaveBeenCalledWith("a@b.co", ["EMAIL"], []);
  expect(sessions).toHaveLength(0);
});

test("opens one session and runs one scan at a time", async () => {
  const first = scanner.scan("one", ["PERSON"]);
  const second = scanner.scan("two", ["PERSON"]);
  await settle();
  expect(sessions).toHaveLength(1);
  expect(sessions[0].scans).toEqual(["one"]);

  sessions[0].next();
  expect(await first).toEqual([NAME]);
  expect(sessions[0].configs[0]).toEqual({
    entities: ["PERSON"],
    detect_uuid: true,
  });
  await settle();
  expect(sessions[0].scans).toEqual(["one", "two"]);
  sessions[0].next();
  expect(await second).toEqual([NAME]);
});

test("opens a new session after one fails", async () => {
  const first = scanner.scan("one", ["PERSON"]);
  await settle();
  sessions[0].next();
  await first;
  sessions[0].status = "error";

  const second = scanner.scan("two", ["PERSON"]);
  await settle();
  expect(sessions).toHaveLength(2);
  expect(sessions[0].closed).toBe(1);
  sessions[1].next();
  await second;
});

test("closes the session when names and addresses are turned off", async () => {
  const first = scanner.scan("one", ["PERSON"]);
  await settle();
  sessions[0].next();
  await first;

  await scanner.scan("two", ["EMAIL"]);
  expect(sessions[0].closed).toBe(1);
});

test("passes a model failure on, without falling back to the rules", async () => {
  scanner = new ModelScanner(async () => {
    throw Object.assign(new Error(), { code: "model_load_failed" });
  });
  await expect(scanner.scan("one", ["PERSON"])).rejects.toMatchObject({
    code: "model_load_failed",
  });
  expect(scanRules).not.toHaveBeenCalledWith("one", ["PERSON"]);
});

test("passes deny list phrases to the model's scan", async () => {
  const scan = scanner.scan("Project Atlas", ["PERSON"], ["Project Atlas"]);
  await settle();
  sessions[0].next();
  await scan;
  expect(sessions[0].configs[0]).toMatchObject({ deny: ["Project Atlas"] });
});

test("model switch waits for active scans, closes the old worker and opens lazily", async () => {
  const replacement = new FakeSession();
  const openReplacement = vi.fn(async () => replacement);
  const first = scanner.scan("old one", ["PERSON"]);
  const second = scanner.scan("old two", ["PERSON"]);
  const switched = scanner.selectModel(openReplacement);
  const third = scanner.scan("new one", ["PERSON"]);
  await settle();
  expect(sessions[0].closed).toBe(0);
  expect(openReplacement).not.toHaveBeenCalled();
  sessions[0].next();
  await first;
  await settle();
  expect(sessions[0].scans).toEqual(["old one", "old two"]);
  expect(sessions[0].closed).toBe(0);
  sessions[0].next();
  await second;
  await switched;
  await settle();
  expect(sessions[0].closed).toBe(1);
  expect(replacement.scans).toEqual(["new one"]);
  replacement.next();
  await third;
  await scanner.selectModel(openReplacement);
  expect(replacement.closed).toBe(0);
  const another = vi.fn(async () => new FakeSession());
  await scanner.selectModel(another);
  expect(replacement.closed).toBe(1);
  expect(another).not.toHaveBeenCalled();
});
