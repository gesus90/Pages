import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type { StorageMaintenanceOptions } from "./StorageMaintenance";

const boundary = vi.hoisted(() => ({
  providers: vi.fn(),
  pnpm: vi.fn(),
  browsers: vi.fn(),
  active: vi.fn(),
}));
vi.mock("./ProviderSessionMaintenance", () => ({
  maintainProviderSessions: boundary.providers,
}));
vi.mock("./SharedEnvironmentMaintenance", () => ({
  pruneSharedStore: boundary.pnpm,
  pruneOldBrowsers: boundary.browsers,
}));
vi.mock("@/backend/agents/cli/CliPlanTemporaryDirectory", () => ({
  activeJobTemporaryIds: boundary.active,
}));

import {
  DEFAULT_STORAGE_RETENTION_MS,
  DEFAULT_TEMP_RETENTION_MS,
  StorageMaintenance,
} from "./StorageMaintenance";

let directory = "";

function fixture(overrides: Partial<StorageMaintenanceOptions> = {}): {
  maintenance: StorageMaintenance;
  repository: StorageMaintenanceOptions["repository"];
  whileIdle: ReturnType<
    typeof vi.fn<StorageMaintenanceOptions["repository"]["whileIdle"]>
  >;
  daily: ReturnType<
    typeof vi.fn<StorageMaintenanceOptions["repository"]["daily"]>
  >;
  claim: ReturnType<
    typeof vi.fn<StorageMaintenanceOptions["repository"]["claimMeasurement"]>
  >;
  warning: ReturnType<
    typeof vi.fn<StorageMaintenanceOptions["repository"]["warning"]>
  >;
  publish: ReturnType<
    typeof vi.fn<StorageMaintenanceOptions["events"]["publish"]>
  >;
} {
  const whileIdle = vi.fn<StorageMaintenanceOptions["repository"]["whileIdle"]>(
    async (work) => work(),
  );
  const daily = vi.fn<StorageMaintenanceOptions["repository"]["daily"]>(
    async (now, work) => work(),
  );
  const claim = vi
    .fn<StorageMaintenanceOptions["repository"]["claimMeasurement"]>()
    .mockResolvedValue(false);
  const warning = vi
    .fn<StorageMaintenanceOptions["repository"]["warning"]>()
    .mockResolvedValue(null);
  const publish = vi.fn<StorageMaintenanceOptions["events"]["publish"]>();
  const repository = { whileIdle, daily, claimMeasurement: claim, warning };
  const maintenance = new StorageMaintenance({
    dataDirectory: path.join(directory, "data"),
    pagesDirectory: directory,
    repository,
    events: { publish },
    readWarningBytes: async () => undefined,
    ...overrides,
  });
  return { maintenance, repository, whileIdle, daily, claim, warning, publish };
}

async function age(location: string, milliseconds: number): Promise<void> {
  await utimes(location, milliseconds / 1000, milliseconds / 1000);
}

beforeEach(async () => {
  const root = pagesTempDirectory("storage-maintenance-tests");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(path.join(root, "case-"));
  boundary.providers.mockReset().mockResolvedValue(undefined);
  boundary.pnpm.mockReset().mockResolvedValue(undefined);
  boundary.browsers.mockReset().mockResolvedValue(undefined);
  boundary.active.mockReset().mockReturnValue(new Set());
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("removes old temporary trees while retaining active jobs, recent descendants and links", async () => {
  const temp = path.join(directory, "tmp");
  const old = path.join(temp, "old");
  const mixed = path.join(temp, "mixed");
  const staleChild = path.join(mixed, "stale");
  const jobs = path.join(temp, "jobs");
  const active = path.join(jobs, "active%2Fjob");
  const expired = path.join(jobs, "expired");
  const recent = path.join(jobs, "recent");
  const agentTemp = path.join(
    directory,
    "data",
    "agents",
    "connection",
    "home",
    ".pages",
    "tmp",
  );
  const outside = path.join(directory, "outside");
  for (const folder of [
    old,
    staleChild,
    active,
    expired,
    recent,
    agentTemp,
    outside,
  ])
    await mkdir(folder, { recursive: true });
  await writeFile(path.join(mixed, "new"), "new");
  await writeFile(path.join(recent, "new"), "recent");
  await writeFile(path.join(outside, "safe"), "safe");
  await mkdir(path.join(agentTemp, "old"));
  await symlink(outside, path.join(temp, "linked"));
  for (const folder of [
    old,
    mixed,
    staleChild,
    jobs,
    active,
    expired,
    recent,
    path.join(agentTemp, "old"),
  ])
    await age(folder, 1000);
  await age(path.join(mixed, "new"), 9000);
  await age(path.join(recent, "new"), 9000);
  const { maintenance } = fixture({
    tempRetentionMs: 2000,
    retentionMs: 3000,
    activeJobIds: () => new Set(["active/job"]),
  });
  await maintenance.run(10000);
  await expect(readdir(old)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readdir(staleChild)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(mixed)).toEqual(["new"]);
  expect((await readdir(jobs)).sort()).toEqual(["active%2Fjob", "recent"]);
  await expect(readdir(path.join(agentTemp, "old"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(path.join(outside, "safe"), "utf8")).toBe("safe");
  expect(boundary.providers).toHaveBeenCalledWith(
    path.join(directory, "data"),
    7000,
  );
  expect(boundary.browsers).toHaveBeenCalledWith(
    path.join(directory, "data", "shared-env"),
    7000,
  );
});

it("publishes a bounded usage warning in descending folder size", async () => {
  const dataDirectory = path.join(directory, "data");
  for (let index = 1; index <= 6; index += 1) {
    const folder = path.join(dataDirectory, `folder${index}`);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "payload"), "x".repeat(index));
  }
  const { maintenance, claim, warning, publish } = fixture({
    readWarningBytes: async () => 1,
  });
  claim.mockResolvedValue(true);
  warning.mockImplementation(async (now, usage) => ({
    type: "storage.limit_exceeded",
    id: "storage",
    storage: usage,
  }));
  await maintenance.run(5000);
  expect(warning).toHaveBeenCalledWith(5000, {
    totalBytes: 21,
    limitBytes: 1,
    largestDirectoryBytes: [6, 5, 4, 3, 2],
  });
  expect(publish).toHaveBeenCalledExactlyOnceWith({
    type: "storage.limit_exceeded",
    id: "storage",
    storage: {
      totalBytes: 21,
      limitBytes: 1,
      largestDirectoryBytes: [6, 5, 4, 3, 2],
    },
  });
});

it("skips warning below the limit or when measurement is not claimed", async () => {
  const readWarningBytes = vi.fn(async () => 100);
  const { maintenance, claim, warning, publish } = fixture({
    readWarningBytes,
  });
  await maintenance.run(1000);
  expect(readWarningBytes).not.toHaveBeenCalled();
  claim.mockResolvedValue(true);
  await maintenance.run(2000);
  expect(readWarningBytes).toHaveBeenCalledOnce();
  expect(warning).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

it("uses dynamic retention and continues after independent maintenance failures", async () => {
  boundary.providers.mockRejectedValueOnce(new Error("provider failed"));
  boundary.pnpm.mockRejectedValueOnce(new Error("prune failed"));
  const { maintenance, claim } = fixture({ readRetentionDays: async () => 2 });
  await maintenance.run(300_000_000);
  expect(boundary.providers).toHaveBeenCalledWith(
    path.join(directory, "data"),
    300_000_000 - 2 * 86400000,
  );
  expect(boundary.browsers).toHaveBeenCalledOnce();
  expect(claim).toHaveBeenCalledOnce();
});

it("falls back from invalid or failed retention settings and ignores overlapping runs", async () => {
  const readRetentionDays = vi
    .fn()
    .mockRejectedValueOnce(new Error("settings failed"))
    .mockResolvedValueOnce(-1);
  const { maintenance, whileIdle } = fixture({
    readRetentionDays,
    retentionMs: -1,
    tempRetentionMs: 0,
  });
  let release: () => void = () => {};
  whileIdle.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const first = maintenance.run(300_000_000);
  await vi.waitFor(() => expect(whileIdle).toHaveBeenCalledOnce());
  await maintenance.run(400_000_000);
  expect(readRetentionDays).toHaveBeenCalledOnce();
  release();
  await first;
  await maintenance.run(300_000_000);
  expect(boundary.providers).toHaveBeenCalledWith(
    path.join(directory, "data"),
    300_000_000 - DEFAULT_STORAGE_RETENTION_MS,
  );
  expect(DEFAULT_TEMP_RETENTION_MS).toBe(90 * 60 * 1000);
});

it("uses the default warning limit and respects a suppressed warning", async () => {
  const dataDirectory = path.join(directory, "data");
  const folder = path.join(dataDirectory, "folder");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "payload"), "hello");
  await writeFile(path.join(dataDirectory, "standalone"), "file");
  await symlink(folder, path.join(dataDirectory, "linked"));
  const { maintenance, claim, warning, publish } = fixture();
  claim.mockResolvedValue(true);
  await maintenance.run(5000);
  expect(warning).not.toHaveBeenCalled();
  expect(boundary.active).toHaveBeenCalledOnce();
  const second = fixture({ readWarningBytes: async () => 1 });
  second.claim.mockResolvedValue(true);
  await second.maintenance.run(6000);
  expect(second.warning).toHaveBeenCalledWith(6000, {
    totalBytes: 9,
    limitBytes: 1,
    largestDirectoryBytes: [5],
  });
  expect(second.publish).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

it("retains malformed encoded active job names and prunes empty stale job roots", async () => {
  const temp = path.join(directory, "tmp");
  const jobs = path.join(temp, "jobs");
  const protectedJob = path.join(jobs, "%invalid");
  await mkdir(protectedJob, { recursive: true });
  await age(protectedJob, 1000);
  await age(jobs, 1000);
  const { maintenance } = fixture({
    tempRetentionMs: 2000,
    activeJobIds: () => new Set(["%invalid"]),
  });
  await maintenance.run(10000);
  expect(await readdir(jobs)).toEqual(["%invalid"]);
  await rm(protectedJob, { recursive: true });
  await age(jobs, 1000);
  await maintenance.run(10000);
  await expect(readdir(jobs)).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps an old parent when a deep descendant is recent", async () => {
  const temp = path.join(directory, "tmp");
  const outer = path.join(temp, "outer");
  const nested = path.join(outer, "middle", "inner");
  const stale = path.join(outer, "stale");
  await mkdir(nested, { recursive: true });
  await mkdir(stale);
  await writeFile(path.join(nested, "new"), "recent");
  for (const folder of [outer, path.join(outer, "middle"), nested, stale])
    await age(folder, 1000);
  await age(path.join(nested, "new"), 9000);
  const { maintenance } = fixture({ tempRetentionMs: 2000 });
  await maintenance.run(10000);
  expect(await readFile(path.join(nested, "new"), "utf8")).toBe("recent");
  await expect(readdir(stale)).rejects.toMatchObject({ code: "ENOENT" });
});

it("preserves non-directory and linked job entries and ignores linked agent homes", async () => {
  const jobs = path.join(directory, "tmp", "jobs");
  const agents = path.join(directory, "data", "agents");
  const outside = path.join(directory, "outside");
  const expired = path.join(jobs, "expired");
  await mkdir(expired, { recursive: true });
  await mkdir(agents, { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(outside, "safe"), "keep");
  await writeFile(path.join(jobs, "plain-file"), "keep");
  await writeFile(path.join(agents, "plain-file"), "keep");
  await symlink(outside, path.join(jobs, "linked-job"));
  await symlink(outside, path.join(agents, "linked-agent"));
  await age(expired, 1000);
  await age(jobs, 9000);
  const { maintenance } = fixture({ tempRetentionMs: 2000 });
  await maintenance.run(10000);
  expect((await readdir(jobs)).sort()).toEqual(["linked-job", "plain-file"]);
  expect(await readFile(path.join(jobs, "plain-file"), "utf8")).toBe("keep");
  expect(await readFile(path.join(outside, "safe"), "utf8")).toBe("keep");
  expect((await readdir(agents)).sort()).toEqual([
    "linked-agent",
    "plain-file",
  ]);
});

it("continues maintenance when an agent has no temporary directory", async () => {
  const agents = path.join(directory, "data", "agents");
  const connection = path.join(agents, "connection");
  const stale = path.join(directory, "tmp", "stale");
  await mkdir(connection, { recursive: true });
  await mkdir(stale, { recursive: true });
  await writeFile(path.join(connection, "keep"), "safe");
  await age(stale, 1000);
  const { maintenance, daily, claim } = fixture({ tempRetentionMs: 2000 });
  await maintenance.run(10000);
  await expect(readdir(stale)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(path.join(connection, "keep"), "utf8")).toBe("safe");
  expect(daily).toHaveBeenCalledOnce();
  expect(claim).toHaveBeenCalledOnce();
});
