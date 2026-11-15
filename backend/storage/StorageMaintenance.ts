import path from "node:path";

import { DEFAULT_STORAGE_WARNING_BYTES } from "@/backend/config/PagesConfig";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { maintainProviderSessions } from "./ProviderSessionMaintenance";
import {
  pruneOldBrowsers,
  pruneSharedStore,
} from "./SharedEnvironmentMaintenance";
import { storageBytes, storageEntries } from "./StorageFiles";

import type { StorageMaintenanceRepository } from "@/backend/database/repositories/storage/StorageMaintenanceRepository";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
      const { repository, dataDirectory } = this.options;
      await this.attempt(() =>
        repository.whileIdle(() =>
          maintainProviderSessions(dataDirectory, now - RETENTION_MS),
        ),
      );
      await this.attempt(() =>
        repository.daily(now, async () => {
          const shared = path.join(dataDirectory, "shared-env");
          await this.attempt(() => pruneSharedStore(shared));
          await this.attempt(() =>
            pruneOldBrowsers(shared, now - RETENTION_MS),
          );
        }),
      );
      await this.attempt(() => this.measure(now));
    } finally {
      this.isRunning = false;
    }
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
