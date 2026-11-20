import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type { Stats } from "node:fs";
import type * as FileSystem from "node:fs/promises";
import type * as StorageFiles from "./StorageFiles";
import type { StorageMaintenanceOptions } from "./StorageMaintenance";

const boundary = vi.hoisted(() => ({
  metadata: vi.fn<(location: string) => Promise<Stats | null>>(),
  rmdir: vi.fn(),
}));
vi.mock("./StorageFiles", async (importOriginal) => ({
  ...(await importOriginal<typeof StorageFiles>()),
  storageMetadata: boundary.metadata,
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  rmdir: boundary.rmdir,
}));
vi.mock("./ProviderSessionMaintenance", () => ({
  maintainProviderSessions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./SharedEnvironmentMaintenance", () => ({
  pruneSharedStore: vi.fn().mockResolvedValue(undefined),
  pruneOldBrowsers: vi.fn().mockResolvedValue(undefined),
}));

import { StorageMaintenance } from "./StorageMaintenance";

function fixture(directory: string): {
  maintenance: StorageMaintenance;
  daily: ReturnType<
    typeof vi.fn<StorageMaintenanceOptions["repository"]["daily"]>
  >;
  claim: ReturnType<
    typeof vi.fn<StorageMaintenanceOptions["repository"]["claimMeasurement"]>
  >;
} {
  const daily = vi.fn<StorageMaintenanceOptions["repository"]["daily"]>(
    async (now, work) => {
      expect(now).toBe(10000);
      await work();
    },
  );
  const claim = vi
    .fn<StorageMaintenanceOptions["repository"]["claimMeasurement"]>()
    .mockResolvedValue(false);
  const repository: StorageMaintenanceOptions["repository"] = {
    whileIdle: async (work) => work(),
    daily,
    claimMeasurement: claim,
    warning: async () => null,
  };
  return {
    maintenance: new StorageMaintenance({
      dataDirectory: path.join(directory, "data"),
      pagesDirectory: directory,
      repository,
      events: { publish: vi.fn() },
      readWarningBytes: async () => undefined,
      activeJobIds: () => new Set(),
      tempRetentionMs: 2000,
    }),
    daily,
    claim,
  };
}

it("tolerates a temporary file disappearing after its directory was listed", async () => {
  const base = pagesTempDirectory("storage-maintenance-race-tests");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, "case-"));
  const oldFolder = path.join(directory, "tmp", "stale");
  const vanishing = path.join(oldFolder, "vanishing");
  const realStorage =
    await vi.importActual<typeof StorageFiles>("./StorageFiles");
  const filesystem =
    await vi.importActual<typeof FileSystem>("node:fs/promises");
  boundary.rmdir.mockImplementation(filesystem.rmdir);
  boundary.metadata.mockImplementation(async (location) => {
    if (location === vanishing) {
      await rm(location);
      return null;
    }
    return realStorage.storageMetadata(location);
  });
  try {
    await mkdir(oldFolder, { recursive: true });
    await writeFile(vanishing, "old");
    await utimes(oldFolder, 1, 1);
    const { maintenance, daily, claim } = fixture(directory);
    await maintenance.run(10000);
    await expect(readdir(oldFolder)).rejects.toMatchObject({ code: "ENOENT" });
    expect(daily).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("continues daily work and measurement when removing an empty job root fails", async () => {
  const base = pagesTempDirectory("storage-maintenance-race-tests");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, "case-"));
  const jobs = path.join(directory, "tmp", "jobs");
  const realStorage =
    await vi.importActual<typeof StorageFiles>("./StorageFiles");
  boundary.metadata.mockImplementation(realStorage.storageMetadata);
  boundary.rmdir
    .mockReset()
    .mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
  try {
    await mkdir(jobs, { recursive: true });
    await utimes(jobs, 1, 1);
    const { maintenance, daily, claim } = fixture(directory);
    await expect(maintenance.run(10000)).resolves.toBeUndefined();
    expect(boundary.rmdir).toHaveBeenCalledWith(jobs);
    expect(await readdir(jobs)).toEqual([]);
    expect(daily).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
