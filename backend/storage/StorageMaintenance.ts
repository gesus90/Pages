import { rm, rmdir } from "node:fs/promises";
import path from "node:path";

import { activeJobTemporaryIds } from "@/backend/agents/cli/CliPlanTemporaryDirectory";
import {
  DEFAULT_STORAGE_RETENTION_DAYS,
  DEFAULT_STORAGE_WARNING_BYTES,
} from "@/backend/config/PagesConfig";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { maintainProviderSessions } from "./ProviderSessionMaintenance";
import {
  pruneOldBrowsers,
  pruneSharedStore,
} from "./SharedEnvironmentMaintenance";
import {
  physicalStorageDirectory,
  storageBytes,
  storageEntries,
  storageMetadata,
} from "./StorageFiles";

import type { StorageMaintenanceRepository } from "@/backend/database/repositories/storage/StorageMaintenanceRepository";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Default provider session and database retention window: 30 days. */
export const DEFAULT_STORAGE_RETENTION_MS =
  DEFAULT_STORAGE_RETENTION_DAYS * DAY_MS;
/** Default maximum age of orphaned temporary subdirectories before idle removal: 90 minutes. */
export const DEFAULT_TEMP_RETENTION_MS = 90 * 60 * 1000;

interface OrphanedTempSweepOptions {
  readonly tempDirectory: string;
  readonly dataDirectory: string;
  readonly cutoff: number;
  readonly activeJobIds: ReadonlySet<string>;
}

function decodeJobSegment(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

async function removeEmptyDirectory(directory: string): Promise<void> {
  try {
    await rmdir(directory);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTEMPTY", "EEXIST", "ENOTDIR"].includes(String(error.code))
    )
      return;
    throw error;
  }
}

async function newestSubtreeMtimeMs(
  directory: string,
  initialMtimeMs: number,
): Promise<number> {
  let newest = initialMtimeMs;
  for (const entry of await storageEntries(directory)) {
    const location = path.join(directory, entry.name);
    const metadata = await storageMetadata(location);
    if (!metadata) continue;
    if (metadata.mtimeMs > newest) newest = metadata.mtimeMs;
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
      const childNewest = await newestSubtreeMtimeMs(
        location,
        metadata.mtimeMs,
      );
      if (childNewest > newest) newest = childNewest;
    }
  }
  return newest;
}

async function pruneOrphanedSubdirectory(
  directory: string,
  directoryMtimeMs: number,
  cutoff: number,
): Promise<void> {
  const newest = await newestSubtreeMtimeMs(directory, directoryMtimeMs);
  if (newest < cutoff) {
    await rm(directory, { recursive: true, force: true });
    return;
  }
  for (const entry of await storageEntries(directory)) {
    const location = path.join(directory, entry.name);
    const metadata = await storageMetadata(location);
    if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory())
      continue;
    await pruneOrphanedSubdirectory(location, metadata.mtimeMs, cutoff);
  }
}

async function pruneJobTemporarySubdirectories(
  jobsRoot: string,
  jobsMtimeMs: number,
  cutoff: number,
  activeJobIds: ReadonlySet<string>,
): Promise<void> {
  for (const entry of await storageEntries(jobsRoot)) {
    const location = path.join(jobsRoot, entry.name);
    const metadata = await storageMetadata(location);
    if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory())
      continue;
    if (activeJobIds.has(decodeJobSegment(entry.name))) continue;
    const newest = await newestSubtreeMtimeMs(location, metadata.mtimeMs);
    if (newest < cutoff) await rm(location, { recursive: true, force: true });
  }
  if (jobsMtimeMs < cutoff) await removeEmptyDirectory(jobsRoot);
}

async function pruneTemporaryRoot(
  root: string,
  cutoff: number,
  activeJobIds: ReadonlySet<string>,
): Promise<void> {
  const rootMetadata = await storageMetadata(root);
  if (
    !rootMetadata ||
    rootMetadata.isSymbolicLink() ||
    !rootMetadata.isDirectory()
  )
    return;
  for (const entry of await storageEntries(root)) {
    const location = path.join(root, entry.name);
    const metadata = await storageMetadata(location);
    if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory())
      continue;
    if (entry.name === "jobs") {
      await pruneJobTemporarySubdirectories(
        location,
        metadata.mtimeMs,
        cutoff,
        activeJobIds,
      );
      continue;
    }
    await pruneOrphanedSubdirectory(location, metadata.mtimeMs, cutoff);
  }
}

async function pruneOrphanedTemporaryDirectories(
  options: OrphanedTempSweepOptions,
): Promise<void> {
  const { tempDirectory, dataDirectory, cutoff, activeJobIds } = options;
  await pruneTemporaryRoot(tempDirectory, cutoff, activeJobIds);
  const agents = await physicalStorageDirectory(dataDirectory, "agents");
  if (!agents) return;
  for (const connection of await storageEntries(agents)) {
    if (!connection.isDirectory() || connection.isSymbolicLink()) continue;
    const connectionTemp = await physicalStorageDirectory(
      path.join(agents, connection.name),
      "home/.pages/tmp",
    );
    if (connectionTemp)
      await pruneTemporaryRoot(connectionTemp, cutoff, activeJobIds);
  }
}

/** Runtime boundaries of the periodic storage sweep. */
export interface StorageMaintenanceOptions {
  readonly dataDirectory: string;
  readonly pagesDirectory: string;
  readonly repository: Pick<
    StorageMaintenanceRepository,
    "whileIdle" | "daily" | "claimMeasurement" | "warning"
  >;
  readonly events: Pick<PagesEventPublisher, "publish">;
  readonly readWarningBytes: () => Promise<number | undefined>;
  /** Optional dynamic retention period in days from instance configuration. */
  readonly readRetentionDays?: () => Promise<number | undefined>;
  /** Optional retention window in milliseconds; overridden by `readRetentionDays` when set. */
  readonly retentionMs?: number;
  /** Optional orphan temporary directory age threshold in milliseconds; defaults to 90 minutes. */
  readonly tempRetentionMs?: number;
  /** Optional instance temporary root; defaults to `<pagesDirectory>/tmp`. */
  readonly tempDirectory?: string;
  /** Active job identifiers whose directories under `jobs/` must stay intact even over the age threshold. */
  readonly activeJobIds?: () => ReadonlySet<string>;
}

/** Reclaims bounded native-agent storage and reports excessive instance growth. */
export class StorageMaintenance {
  private readonly options: StorageMaintenanceOptions;
  private isRunning = false;

  public constructor(options: StorageMaintenanceOptions) {
    this.options = options;
  }

  /** Sweeps at startup and each maintenance tick; overlapping ticks never duplicate a scan. */
  public async run(now = Date.now()): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const { repository, dataDirectory, pagesDirectory } = this.options;
      const retentionMs = await this.resolveRetentionMs();
      const tempRetentionMs = this.resolveTempRetentionMs();
      const tempDirectory =
        this.options.tempDirectory ?? path.join(pagesDirectory, "tmp");
      await this.attempt(() =>
        repository.whileIdle(async () => {
          const activeJobIds =
            this.options.activeJobIds?.() ?? activeJobTemporaryIds();
          await this.attempt(() =>
            maintainProviderSessions(dataDirectory, now - retentionMs),
          );
          await this.attempt(() =>
            pruneOrphanedTemporaryDirectories({
              tempDirectory,
              dataDirectory,
              cutoff: now - tempRetentionMs,
              activeJobIds,
            }),
          );
        }),
      );
      await this.attempt(() =>
        repository.daily(now, async () => {
          const shared = path.join(dataDirectory, "shared-env");
          await this.attempt(() => pruneSharedStore(shared));
          await this.attempt(() => pruneOldBrowsers(shared, now - retentionMs));
        }),
      );
      await this.attempt(() => this.measure(now));
    } finally {
      this.isRunning = false;
    }
  }

  private async resolveRetentionMs(): Promise<number> {
    const fallback = this.isPositiveDuration(this.options.retentionMs)
      ? this.options.retentionMs
      : DEFAULT_STORAGE_RETENTION_MS;
    if (!this.options.readRetentionDays) return fallback;
    try {
      const days = await this.options.readRetentionDays();
      if (days !== undefined && Number.isInteger(days) && days > 0)
        return days * DAY_MS;
    } catch (error: unknown) {
      logCaughtError("StorageMaintenance", error);
    }
    return fallback;
  }

  private resolveTempRetentionMs(): number {
    return this.isPositiveDuration(this.options.tempRetentionMs)
      ? this.options.tempRetentionMs
      : DEFAULT_TEMP_RETENTION_MS;
  }

  private isPositiveDuration(value: number | undefined): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }

  private async measure(now: number): Promise<void> {
    const {
      repository,
      dataDirectory,
      pagesDirectory,
      events,
      readWarningBytes,
    } = this.options;
    if (!(await repository.claimMeasurement(now))) return;
    const limitBytes =
      (await readWarningBytes()) ?? DEFAULT_STORAGE_WARNING_BYTES;
    const totalBytes = await storageBytes(pagesDirectory);
    if (totalBytes <= limitBytes) return;
    const directories: { name: string; bytes: number }[] = [];
    for (const entry of await storageEntries(dataDirectory)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      directories.push({
        name: entry.name,
        bytes: await storageBytes(path.join(dataDirectory, entry.name)),
      });
    }
    const largest = directories
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, 5);
    logEvent({
      level: "warn",
      event: "storage.limit_exceeded",
      component: "StorageMaintenance",
      message: `Pages storage uses ${totalBytes} bytes (limit ${limitBytes}); largest data folders: ${largest.map((entry) => `${JSON.stringify(entry.name)}: ${entry.bytes} bytes`).join(", ")}`,
      metadata: { bytes: totalBytes },
    });
    const event = await repository.warning(now, {
      totalBytes,
      limitBytes,
      largestDirectoryBytes: largest.map((entry) => entry.bytes),
    });
    if (event) events.publish(event);
  }

  private async attempt(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error: unknown) {
      logCaughtError("StorageMaintenance", error);
    }
  }
}
