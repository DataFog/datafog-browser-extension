/** The offscreen boundary serializes encrypted state and fails closed. */
import { beforeEach, expect, test, vi } from "vitest";
import { countFindings, redact } from "./detect";
import type { OffscreenRequest, Request } from "./messages";
import { DEFAULT_SETTINGS } from "./settings";

const state = vi.hoisted(() => ({
  route: { recordId: "record", namespace: "namespace" },
  preferences: null as unknown,
  read: vi.fn<() => Promise<unknown>>(),
  write: vi.fn<(value: unknown) => Promise<void>>(),
  access: vi.fn<() => Promise<void>>(),
  create: vi.fn(),
  replace: vi.fn(async () => ({ text: "[[EMAIL_A]]", edits: [], saved: true })),
  preview: vi.fn(async () => ({
    findings: [
      { entityType: "EMAIL", original: "a@b.co", marker: "[[EMAIL_A]]" },
    ],
    previewId: "preview-a",
  })),
}));
vi.mock("./detect", () => ({
  ready: vi.fn(async () => {}),
  countFindings: vi.fn(async () => ({ EMAIL: 1 })),
  redact: vi.fn(async () => ({ text: "[EMAIL]", edits: [] })),
  workspaceFindings: vi.fn(async () => []),
  skipChoices: vi.fn((scanner: unknown) => scanner),
}));
vi.mock("@datafog/wasm/cnn", () => ({ CnnSession: { open: vi.fn() } }));
vi.mock("./device", () => ({
  DeviceKeys: class {
    async load() {}
    async readRouting() {
      return state.route;
    }
    async writeRouting() {}
    async readPreferences() {
      return state.read();
    }
    async writePreferences(value: unknown) {
      return state.write(value);
    }
  },
}));
vi.mock("./vault", () => ({
  VaultHost: class {
    automaticAccess = state.access;
    create = state.create;
    replace = state.replace;
    preview = state.preview;
    status() {
      return { state: "locked", notSensitive: [] };
    }
    notSensitive() {
      return [];
    }
  },
}));

type Listener = (
  message: OffscreenRequest | Request,
  sender: object,
  respond: (response: unknown) => void,
) => boolean;
let listener: Listener;
function forward(
  request: OffscreenRequest["request"],
  settings = DEFAULT_SETTINGS,
): Promise<unknown> {
  return new Promise((resolve) =>
    listener(
      {
        target: "offscreen",
        request,
        settings,
        legacySettings: settings,
        host: "chatgpt.com",
      },
      {},
      resolve,
    ),
  );
}
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  state.preferences = null;
  state.access.mockResolvedValue();
  state.read.mockImplementation(async () => state.preferences);
  state.write.mockImplementation(async (value) => {
    state.preferences = value;
  });
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: {
        addListener: (added: Listener) => {
          listener = added;
        },
      },
    },
  });
  await import("./offscreen");
});
test("leaves unforwarded content messages to the service worker", () => {
  const respond = vi.fn();
  expect(listener({ type: "scan", seq: 1, text: "a@b.co" }, {}, respond)).toBe(
    false,
  );
  expect(respond).not.toHaveBeenCalled();
});
test("initializes encrypted policy before reporting scan and preview results", async () => {
  expect(await forward({ type: "scan", seq: 3, text: "a@b.co" })).toMatchObject(
    {
      result: {
        seq: 3,
        enabled: true,
        counts: { EMAIL: 1 },
        blockSends: false,
        findings: [{ original: "a@b.co", marker: "[[EMAIL_A]]" }],
        policyVersion: expect.any(String),
      },
      storage: { routing: state.route, migrated: true },
    },
  );
  expect(state.write).toHaveBeenCalledOnce();
});
test("keeps legacy global off semantics after encrypted migration", async () => {
  expect(
    await forward(
      { type: "scan", seq: 4, text: "a@b.co" },
      { ...DEFAULT_SETTINGS, enabled: false, off: ["chatgpt.com"] },
    ),
  ).toMatchObject({
    result: { enabled: false, counts: {}, blockSends: false },
  });
  expect(countFindings).not.toHaveBeenCalled();
});
test("missing existing key refuses checking without resetting the store", async () => {
  state.access.mockRejectedValueOnce(
    Object.assign(new Error(), { code: "vault_key_missing" }),
  );
  expect(await forward({ type: "scan", seq: 4, text: "a@b.co" })).toEqual({
    error: "vault_key_missing",
  });
  expect(state.create).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
  expect(countFindings).not.toHaveBeenCalled();
});
test("migration write failure retains legacy source and prevents scanning", async () => {
  state.write.mockRejectedValueOnce(
    Object.assign(new Error(), { code: "preferences_verification_failed" }),
  );
  expect(await forward({ type: "scan", seq: 1, text: "a@b.co" })).toEqual({
    error: "preferences_verification_failed",
  });
  expect(countFindings).not.toHaveBeenCalled();
  expect(
    await forward({ type: "scan", seq: 2, text: "a@b.co" }),
  ).toHaveProperty("storage.migrated", true);
});
test("encrypted corruption does not fall back to defaults or overwrite data", async () => {
  state.read.mockRejectedValueOnce(
    Object.assign(new Error(), { code: "preferences_unavailable" }),
  );
  expect(await forward({ type: "settings-get" })).toEqual({
    error: "preferences_unavailable",
  });
  expect(state.write).not.toHaveBeenCalled();
});
test("logs codes without prompt content", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(redact).mockRejectedValueOnce(
    Object.assign(new Error("a@b.co"), { code: "invalid_input" }),
  );
  expect(await forward({ type: "redact", text: "a@b.co" })).toEqual({
    error: "invalid_input",
  });
  expect(warn).toHaveBeenCalledWith("datafog redact failed: invalid_input");
  expect(JSON.stringify(warn.mock.calls)).not.toContain("a@b.co");
  warn.mockRestore();
});

test("missing previously initialized ciphertext is never silently replaced with defaults", async () => {
  const response = await new Promise((resolve) =>
    listener(
      {
        target: "offscreen",
        request: { type: "settings-get" },
        settings: DEFAULT_SETTINGS,
        routing: { ...state.route, preferences: 1 },
      },
      {},
      resolve,
    ),
  );
  expect(response).toEqual({ error: "preferences_missing" });
  expect(state.write).not.toHaveBeenCalled();
});

test("a lost automatic-only key does not advertise a nonexistent recovery password", async () => {
  state.access.mockRejectedValueOnce(
    Object.assign(new Error(), { code: "vault_key_missing" }),
  );
  const response = await new Promise((resolve) =>
    listener(
      {
        target: "offscreen",
        request: { type: "vault-status" },
        settings: DEFAULT_SETTINGS,
        routing: { ...state.route, automatic: true },
      },
      {},
      resolve,
    ),
  );
  expect(response).toMatchObject({
    result: { access: "unavailable", reviewError: "vault_key_missing" },
  });
});

test("reports a saved mapping truthfully when only the sidebar index fails", async () => {
  await forward({ type: "settings-get" });
  state.write.mockRejectedValueOnce(new Error("disk"));
  expect(
    await forward({ type: "pseudonymize", text: "a@b.co", tabId: 7 }),
  ).toMatchObject({
    result: {
      text: "[[EMAIL_A]]",
      saved: true,
      warning: "originals_index_unavailable",
    },
  });
});

test("an ambiguously saved policy revokes its old cache until durable readback reconciles", async () => {
  await forward({ type: "scan", seq: 1, text: "a@b.co" });
  state.write.mockImplementationOnce(async (value) => {
    state.preferences = value; // The transaction committed; its readback failed.
    throw Object.assign(new Error(), {
      code: "preferences_verification_failed",
    });
  });
  expect(
    await forward({
      type: "settings-save",
      settings: { ...DEFAULT_SETTINGS, blockSends: true },
    }),
  ).toEqual({ error: "preferences_verification_failed" });
  vi.mocked(countFindings).mockClear();
  state.read.mockRejectedValueOnce(
    Object.assign(new Error(), { code: "preferences_unavailable" }),
  );
  expect(await forward({ type: "scan", seq: 2, text: "a@b.co" })).toEqual({
    error: "preferences_unavailable",
  });
  expect(countFindings).not.toHaveBeenCalled();
  const reconciled = await forward({ type: "scan", seq: 3, text: "a@b.co" });
  expect(reconciled).toMatchObject({
    result: {
      blockSends: true,
      counts: { EMAIL: 1 },
      policyVersion: expect.any(String),
    },
  });

  expect(state.write).toHaveBeenCalledTimes(2); // Reconciliation reads, never overwrites.
});
