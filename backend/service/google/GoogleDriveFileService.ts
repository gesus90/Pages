import { GOOGLE_EXPORT_FORMATS } from "@/backend/google/GoogleDriveFormats";
import { StorageBatchWriter } from "@/backend/service/google/StorageBatchWriter";
import { StorageConfirmations } from "@/backend/service/google/StorageConfirmations";
import {
  STORAGE_MAX_READ_BYTES,
  STORAGE_PAGE_SIZE_LIMIT,
  StorageFileReader,
} from "@/backend/service/google/StorageFileReader";
import { openStorageSession } from "@/backend/service/google/StorageFileSupport";
import {
  STORAGE_MAX_UPLOAD_BYTES,
  StorageFileWriter,
} from "@/backend/service/google/StorageFileWriter";
import {
  STORAGE_OPERATIONS,
  STORAGE_READ_OPERATIONS,
} from "@/definition/GoogleDriveFiles";

import { accountStorageFiles } from "./StorageAccountFiles";

import type { StorageAccountFiles } from "./StorageAccountFiles";
import type { StorageAccessService } from "./StorageAccessService";
import type {
  StorageConnection,
  StorageDriveClient,
} from "@/backend/service/google/StorageFileSupport";
import type {
  StorageCapabilities,
  StorageResult,
} from "@/definition/GoogleDriveFiles";

/** Collaborators of the file service. */
export interface GoogleDriveFileDependencies {
  readonly access?: StorageAccessService;
  readonly connection: StorageConnection;
  readonly drive: StorageDriveClient;
  /** Whether the Drive behind the connection is the in-memory simulation. */
  readonly isSimulation: boolean;
  /** Whether a targeted write consent can be started (an OAuth client exists). */
  readonly canRequestWriteAccess: boolean;
}

/**
 * The Storage interface (PAGE-270): manages files and folders of the instance
 * Google Drive through stable references.
 *
 * @remarks
 * `reader` holds the reading operations, `writer` the changing ones; both
 * take a freshly confirmed access on every call. Rights of Pages are checked
 * by the route before any call reaches this service.
 */
export class GoogleDriveFileService {
  public readonly reader: StorageFileReader;
  public readonly writer: StorageFileWriter;
  /** Copy, move and trash for several entries of one folder (PAGE-272). */
  public readonly batch: StorageBatchWriter;
  public readonly isSimulation: boolean;
  private readonly access: StorageAccessService | null;
  private readonly connection: StorageConnection;
  private readonly canRequestWriteAccess: boolean;

  /**
   * Creates the service.
   *
   * @param dependencies - Connection, Drive client and the simulation marker.
   */
  public constructor(dependencies: GoogleDriveFileDependencies) {
    this.access = dependencies.access ?? null;
    this.connection = dependencies.connection;
    this.isSimulation = dependencies.isSimulation;
    this.canRequestWriteAccess = dependencies.canRequestWriteAccess;
    this.reader = new StorageFileReader(
      dependencies.connection,
      dependencies.drive,
    );
    this.writer = new StorageFileWriter(
      dependencies.connection,
      dependencies.drive,
      new StorageConfirmations(),
    );
    this.batch = new StorageBatchWriter(
      dependencies.connection,
      dependencies.drive,
      this.writer,
    );
  }

  /** Binds every operation and its history to the authenticated Pages account. */
  public forAccount(userId: string): StorageAccountFiles {
    return accountStorageFiles(this, userId, this.access);
  }

  /**
   * Names what the connected account and this instance allow right now.
   *
   * @returns Read and write right, limits, operations and export formats.
   */
  public async capabilities(): Promise<StorageResult<StorageCapabilities>> {
    const session = await openStorageSession(this.connection);

    if (!session.ok) return session;

    const canWrite = session.value.canWrite;

    return {
      ok: true,
      value: {
        canRead: true,
        canRequestWriteAccess: !canWrite && this.canRequestWriteAccess,
        canWrite,
        exportFormats: GOOGLE_EXPORT_FORMATS,
        isSimulation: this.isSimulation,
        maxReadBytes: STORAGE_MAX_READ_BYTES,
        maxUploadBytes: STORAGE_MAX_UPLOAD_BYTES,
        operations: canWrite ? STORAGE_OPERATIONS : STORAGE_READ_OPERATIONS,
        pageSizeLimit: STORAGE_PAGE_SIZE_LIMIT,
      },
    };
  }
}
