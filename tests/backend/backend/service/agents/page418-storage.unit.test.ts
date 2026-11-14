import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import {
  sharedAgentEnvironment,
  sharedPnpmBin,
} from "@/backend/agents/cli/AgentSharedEnvironment";
import {
  readPagesConfig,
  writePagesConfig,
  DEFAULT_STORAGE_WARNING_BYTES,
} from "@/backend/config/PagesConfig";
import { StorageMaintenanceRepository } from "@/backend/database/repositories/storage/StorageMaintenanceRepository";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { isPagesEventType } from "@/backend/service/events/PagesEventPublisher";
import { StorageMaintenance } from "@/backend/storage/StorageMaintenance";
import { pruneOldBrowsers } from "@/backend/storage/SharedEnvironmentMaintenance";

import {
  StorageDatabase,
  storageFiles as files,
} from "./page418-storage-fixture";

const boundary = vi.hoisted(() => ({
  prune: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return {
    execFile: Object.assign(() => undefined, {
      [promisify.custom]: boundary.prune,
    }),
  };
});
vi.mock("node:fs/promises", async () => {
  const { storageFiles } = await import("./page418-storage-fixture");
  return storageFiles.module();
});
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
  logDiagnostic: vi.fn(),
}));

const ROOT = "/synthetic/page418";
const DATA = `${ROOT}/data`;
const SHARED = `${DATA}/shared-env`;
const NOW = Date.UTC(2026, 10, 14);
const DAY = 86_400_000;
const HOUR = 3_600_000;
const CUTOFF = NOW - 30 * DAY;

function service(
  database: StorageDatabase,
  limit = 1000,
): { maintenance: StorageMaintenance; publish: ReturnType<typeof vi.fn> } {
  const publish = vi.fn();
  return {
    publish,
    maintenance: new StorageMaintenance({
      dataDirectory: DATA,
      pagesDirectory: ROOT,
      repository: new StorageMaintenanceRepository(database),
      events: { publish },
      readWarningBytes: async () => limit,
    }),
  };
}

beforeEach(() => {
  files.reset();
  vi.clearAllMocks();
  boundary.prune.mockResolvedValue({ stdout: "", stderr: "" });
});

it.each(["lease", "owner"] as const)(
  "defers all native storage while a %s is retained, retries next tick and prunes once per 24h across restarts",
  async (busy) => {
    const database = new StorageDatabase();
    database.busy = busy;
    files.seed(`${sharedPnpmBin(SHARED)}/pnpm`);
    files.seed(`${DATA}/agents/idle/opencode/pnpm/package`);
    const initial = [...files.entries];
    await service(database).maintenance.run(NOW);
    expect(boundary.prune).not.toHaveBeenCalled();
    expect([...files.entries]).toEqual(initial);
    expect(database.runs.has("shared-environment")).toBe(false);
    database.busy = null;
    boundary.prune.mockImplementation(async () => {
      expect(database.isInTransaction).toBe(true);
      return { stdout: "", stderr: "" };
    });
    await service(database).maintenance.run(NOW + 60_000);
    expect(boundary.prune).toHaveBeenCalledOnce();
    expect(files.entries.has(`${DATA}/agents/idle/opencode/pnpm`)).toBe(false);
    expect(boundary.prune).toHaveBeenCalledWith(
      path.join(sharedPnpmBin(SHARED), "pnpm"),
      ["store", "prune"],
      expect.objectContaining({
        cwd: SHARED,
        env: expect.objectContaining(sharedAgentEnvironment(SHARED)),
      }),
    );
    await service(database).maintenance.run(NOW + DAY);
    expect(boundary.prune).toHaveBeenCalledOnce();
    await service(database).maintenance.run(NOW + DAY + 60_000);
    expect(boundary.prune).toHaveBeenCalledTimes(2);
  },
);

it("serializes simultaneous daily sweeps and records failed attempts without retrying every minute", async () => {
  const database = new StorageDatabase();
  files.seed(`${sharedPnpmBin(SHARED)}/pnpm`);
  boundary.prune.mockRejectedValue(new Error("Synthetic prune failure"));
  await Promise.all([
    service(database).maintenance.run(NOW),
    service(database).maintenance.run(NOW),
  ]);
  await service(database).maintenance.run(NOW + 60_000);
  expect(boundary.prune).toHaveBeenCalledOnce();
  expect(logCaughtError).toHaveBeenCalledWith(
    "StorageMaintenance",
    expect.any(Error),
  );
});

it("expires old transcripts for all four providers, keeps exact-boundary and recent files and preserves credentials, config, databases and unrelated paths", async () => {
  const directories = [
    "codex/sessions",
    "claude/projects",
    "opencode/opencode/storage",
    "antigravity/antigravity-acp/nested/sessions",
    "antigravity/antigravity-acp/history",
  ];
  for (const connection of ["one", "two"]) {
    for (const folder of directories) {
      const directory = `${DATA}/agents/${connection}/${folder}`;
      files.seed(`${directory}/empty-after/old.jsonl`, {
        modified: CUTOFF - 1,
      });
      files.seed(`${directory}/new.jsonl`, { modified: CUTOFF + 1 });
      files.seed(`${directory}/boundary.jsonl`, { modified: CUTOFF });
      for (const protectedName of [
        "auth.json",
        ".credentials.json",
        "config.toml",
        "config/sub/file",
        "logs_2.sqlite",
        "logs_2.sqlite-wal",
        "state.db",
        "acp_token.json",
        "settings.json",
      ])
        files.seed(`${directory}/${protectedName}`, { modified: 0 });
    }
    files.seed(
      `${DATA}/agents/${connection}/antigravity/antigravity-acp/history.json`,
      { modified: 0 },
    );
    files.seed(
      `${DATA}/agents/${connection}/antigravity/antigravity-acp/unknown-state.json`,
    );
    files.seed(`${DATA}/agents/${connection}/codex/logs_2.sqlite`);
    files.seed(`${DATA}/agents/${connection}/home/cache/other`);
    files.seed(`${DATA}/agents/${connection}/opencode/pnpm/legacy`);
  }
  const before = [...files.entries].filter(
    ([location, entry]) =>
      entry.kind === "file" &&
      !location.includes("/empty-after/") &&
      !location.endsWith("/history.json") &&
      !location.includes("/opencode/pnpm/"),
  );
  await service(new StorageDatabase()).maintenance.run(NOW);
  for (const [location, entry] of before)
    expect(files.entries.get(location)).toEqual(entry);
  expect(
    [...files.entries.keys()].some((location) =>
      location.includes("/empty-after"),
    ),
  ).toBe(false);
  expect(
    [...files.entries.keys()].some((location) =>
      location.includes("/opencode/pnpm"),
    ),
  ).toBe(false);
  expect(
    [...files.entries.keys()].some((location) =>
      location.endsWith("/history.json"),
    ),
  ).toBe(false);
});

it("never follows connection, provider, transcript or nested symlinks", async () => {
  const locations = [
    "linked",
    "provider/codex",
    "transcript/codex/sessions",
    "nested/codex/sessions/link",
    "legacy/opencode",
    "antigravity/antigravity/antigravity-acp",
  ];
  for (const relative of locations) {
    const location = `${DATA}/agents/${relative}`;
    files.seed(`${location}/outside.json`, { modified: 0 });
    files.seed(location, { kind: "link" });
  }
  const before = [...files.entries];
  await service(new StorageDatabase()).maintenance.run(NOW);
  expect([...files.entries]).toEqual(before);
  expect(files.removed).toEqual([]);
});

it("removes only aged unused browser revisions and preserves locked revisions, overrides, new browsers, links and other directories", async () => {
  const browsers = `${SHARED}/cache/ms-playwright`;
  const preserved = [
    "chromium-1243",
    "chromium_headless_shell-1243",
    "webkit-2359",
    "webkit-2251",
    ".links",
    "unrelated-123",
  ];
  for (const name of [...preserved, "chromium-1000", "firefox-1000"])
    files.seed(`${browsers}/${name}/binary`, { modified: 0 });
  files.seed(`${browsers}/firefox-1500`, {
    kind: "directory",
    modified: CUTOFF,
  });
  files.seed(`${browsers}/chromium-1200`, { kind: "directory", modified: NOW });
  files.seed(`${browsers}/webkit-1000`, { kind: "link" });
  await pruneOldBrowsers(SHARED, CUTOFF);
  expect(files.removed.sort()).toEqual([
    `${browsers}/chromium-1000`,
    `${browsers}/firefox-1000`,
  ]);
  for (const name of preserved)
    expect(files.entries.has(`${browsers}/${name}`)).toBe(true);
  expect(files.entries.has(`${browsers}/firefox-1500`)).toBe(true);
  expect(files.entries.has(`${browsers}/chromium-1200`)).toBe(true);
  expect(files.entries.has(`${browsers}/webkit-1000`)).toBe(true);
});

it.each(["mismatch", "missing manifest"])(
  "keeps every browser when revision evidence is unavailable: %s",
  async (failure) => {
    files.seed(`${SHARED}/cache/ms-playwright/chromium-1000/binary`);
    if (failure === "mismatch") files.lockVersion = "0.0.0";
    else files.hasManifest = false;
    await expect(pruneOldBrowsers(SHARED, CUTOFF)).rejects.toThrow();
    expect(files.removed).toEqual([]);
  },
);

it("measures the whole instance hourly, logs the five largest data directories and emits sizes only once per day across restarts", async () => {
  const database = new StorageDatabase();
  for (let index = 1; index <= 7; index++)
    files.seed(`${DATA}/folder${index}/file`, { size: index * 100 });
  files.seed(`${ROOT}/logs/current.log`, { size: 70 });
  files.seed(`${ROOT}/Agents/agent/AGENT.md`, { size: 30 });
  files.seed(`${DATA}/linked-outside`, { kind: "link", size: 999999 });
  const first = service(database);
  await first.maintenance.run(NOW);
  expect(first.publish).toHaveBeenCalledWith({
    type: "storage.limit_exceeded",
    id: "storage",
    storage: {
      totalBytes: 2900,
      limitBytes: 1000,
      largestDirectoryBytes: [700, 600, 500, 400, 300],
    },
  });
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "warn",
      message: expect.stringContaining('"folder7": 700 bytes'),
    }),
  );
  const message = vi.mocked(logEvent).mock.calls[0]?.[0].message;
  expect(message).not.toContain('"folder2"');
  expect(message).not.toContain('"folder1"');
  const restarted = service(database);
  await restarted.maintenance.run(NOW + HOUR - 1);
  expect(logEvent).toHaveBeenCalledOnce();
  await restarted.maintenance.run(NOW + HOUR);
  expect(logEvent).toHaveBeenCalledTimes(2);
  expect(restarted.publish).not.toHaveBeenCalled();
  await restarted.maintenance.run(NOW + DAY);
  expect(restarted.publish).toHaveBeenCalledOnce();
  const inbox = database.writes.filter((entry) =>
    entry.statement.includes("INSERT INTO automation_events"),
  );
  expect(inbox).toHaveLength(2);
  expect(JSON.parse(String(inbox[0]?.parameters?.payload))).toEqual({
    totalBytes: 2900,
    limitBytes: 1000,
    largestDirectoryBytes: [700, 600, 500, 400, 300],
  });
  expect(inbox[0]?.statement).toContain("WHERE EXISTS");
  expect(
    database.writes.filter((entry) =>
      entry.statement.includes("INSERT INTO pages_event_outbox"),
    ),
  ).toHaveLength(2);
});

it("does not warn at or below the threshold and rolls back event cadence if inbox persistence fails", async () => {
  const database = new StorageDatabase();
  files.seed(`${ROOT}/config.toml`, { size: 1000 });
  await service(database).maintenance.run(NOW);
  expect(logEvent).not.toHaveBeenCalled();
  database.failsInbox = true;
  const failed = service(database, 999);
  await failed.maintenance.run(NOW + HOUR);
  expect(failed.publish).not.toHaveBeenCalled();
  expect(database.runs.has("warning")).toBe(false);
  expect(
    database.writes.some((entry) =>
      entry.statement.includes("INSERT INTO pages_event_outbox"),
    ),
  ).toBe(false);
  database.failsInbox = false;
  const retry = service(database, 999);
  await retry.maintenance.run(NOW + 2 * HOUR);
  expect(retry.publish).toHaveBeenCalledOnce();
});

it("accepts a configurable positive byte threshold, round-trips it, and defaults to 20 GB", () => {
  expect(
    readPagesConfig({}, "synthetic").storageWarningBytes ??
      DEFAULT_STORAGE_WARNING_BYTES,
  ).toBe(DEFAULT_STORAGE_WARNING_BYTES);
  expect(DEFAULT_STORAGE_WARNING_BYTES).toBe(20_000_000_000);
  const config = readPagesConfig({ storageWarningBytes: 12345 }, "synthetic");
  expect(writePagesConfig({}, config).storageWarningBytes).toBe(12345);
  for (const invalid of [0, -1, 1.5, "100", Number.MAX_SAFE_INTEGER + 1])
    expect(() =>
      readPagesConfig({ storageWarningBytes: invalid }, "synthetic"),
    ).toThrow("storageWarningBytes");
  expect(isPagesEventType("storage.limit_exceeded")).toBe(true);
});

it("uses the 20 GB default at runtime when the optional configuration key is absent", async () => {
  files.seed(`${ROOT}/size`, { size: DEFAULT_STORAGE_WARNING_BYTES + 1 });
  const publish = vi.fn();
  await new StorageMaintenance({
    dataDirectory: DATA,
    pagesDirectory: ROOT,
    repository: new StorageMaintenanceRepository(new StorageDatabase()),
    events: { publish },
    readWarningBytes: async () =>
      readPagesConfig({}, "synthetic").storageWarningBytes,
  }).run(NOW);
  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({
      storage: {
        totalBytes: DEFAULT_STORAGE_WARNING_BYTES + 1,
        limitBytes: DEFAULT_STORAGE_WARNING_BYTES,
        largestDirectoryBytes: [],
      },
    }),
  );
});
