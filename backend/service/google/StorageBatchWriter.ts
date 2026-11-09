import {
  isStorageRef,
  openStorageSession,
  readLiveEntry,
  readLiveFolder,
  storageFailure,
  writeRefusal,
} from "@/backend/service/google/StorageFileSupport";
import { STORAGE_BATCH_LIMIT } from "@/definition/GoogleDriveFiles";
import {
  STORAGE_MY_DRIVE_ID,
  STORAGE_SHARED_DRIVES_ID,
} from "@/definition/GoogleDriveStorage";

import type { StorageActor } from "@/backend/service/google/StorageFileRequests";
import type {
  StorageConnection,
  StorageDriveClient,
  StorageSession,
} from "@/backend/service/google/StorageFileSupport";
import type { StorageFileWriter } from "@/backend/service/google/StorageFileWriter";
import type {
  StorageBatchAction,
  StorageBatchFailure,
  StorageBatchResult,
  StorageEntry,
  StorageErrorCode,
  StorageResult,
} from "@/definition/GoogleDriveFiles";

/** One `batch` call as the route read it; nothing in it is trusted yet. */
export interface StorageBatchRequest extends StorageActor {
  readonly action: string | null;
  /** The loaded folder every entry has to lie in. */
  readonly sourceRef: string | null;
  readonly refs: readonly string[] | null;
  /** The folder copies and moved entries go to; unused for `delete`. */
  readonly targetParentRef: string | null;
}

/** A request whose shape was checked. */
interface CheckedBatch extends StorageActor {
  readonly action: StorageBatchAction;
  readonly sourceRef: string;
  readonly refs: readonly string[];
  readonly targetParentRef: string | null;
}

/** Codes after which Drive answers no further entry either. */
const STOPPING_CODES: readonly StorageErrorCode[] = [
  "connection_unavailable",
  "provider_unreachable",
  "provider_scope_missing",
];

const BATCH_ACTIONS: readonly StorageBatchAction[] = ["copy", "move", "delete"];

/** The roots and the shared-drive list are no entries that can change. */
function isChangeableRef(ref: string): boolean {
  return (
    isStorageRef(ref) &&
    ref !== STORAGE_MY_DRIVE_ID &&
    ref !== STORAGE_SHARED_DRIVES_ID
  );
}

function checkBatch(request: StorageBatchRequest): CheckedBatch | null {
  const action = BATCH_ACTIONS.find((known) => known === request.action);
  const refs = request.refs ?? [];
  const sourceRef = request.sourceRef ?? "";
  const target = request.targetParentRef;
  const needsTarget = action === "copy" || action === "move";
  const isTargetValid = needsTarget
    ? target !== null &&
      isStorageRef(target) &&
      target !== STORAGE_SHARED_DRIVES_ID
    : target === null;

  if (
    action === undefined ||
    refs.length === 0 ||
    refs.length > STORAGE_BATCH_LIMIT ||
    new Set(refs).size !== refs.length ||
    !refs.every(isChangeableRef) ||
    !isStorageRef(sourceRef) ||
    sourceRef === STORAGE_SHARED_DRIVES_ID ||
    !isTargetValid
  ) {
    return null;
  }

  return {
    action,
    refs,
    sourceRef,
    targetParentRef: target,
    userId: request.userId,
  };
}

/**
 * Changes several entries of one folder with one call (PAGE-272): copy,
 * move or move to the trash.
 *
 * @remarks
 * Every entry has to lie in the named source folder, at most
 * {@link STORAGE_BATCH_LIMIT} per call. The entries run one after another
 * through the single operations of {@link StorageFileWriter}, so their checks
 * hold for each; one refused entry does not stop the others. Copies and moved
 * entries keep both names when the target already holds one (Drive allows
 * equal names). Folders are not copied, as Google Drive cannot copy them.
 * Moving to the trash is reversible and the view confirms the whole selection
 * before the call, so a folder's own confirmation is issued and spent here.
 */
export class StorageBatchWriter {
  private readonly connection: StorageConnection;
  private readonly drive: StorageDriveClient;
  private readonly writer: StorageFileWriter;

  /**
   * Creates the batch writer.
   *
   * @param connection - The Drive connection.
   * @param drive - The Drive client.
   * @param writer - The single changing operations.
   */
  public constructor(
    connection: StorageConnection,
    drive: StorageDriveClient,
    writer: StorageFileWriter,
  ) {
    this.connection = connection;
    this.drive = drive;
    this.writer = writer;
  }

  /**
   * Runs one action for every named entry.
   *
   * @param request - Action, source folder, entries and target folder.
   * @returns How many entries changed and which were refused with their reason.
   */
  public async run(
    request: StorageBatchRequest,
  ): Promise<StorageResult<StorageBatchResult>> {
    const batch = checkBatch(request);

    if (batch === null) return storageFailure("invalid_request");

    const session = await openStorageSession(this.connection);

    if (!session.ok) return session;

    const refusal = writeRefusal<StorageBatchResult>(session.value);

    if (refusal) return refusal;

    const source = await readLiveFolder(
      this.drive,
      session.value,
      batch.sourceRef,
    );

    if (!source.ok) return source;

    return {
      ok: true,
      value: await this.runEntries(session.value, batch, source.value),
    };
  }

  private async runEntries(
    session: StorageSession,
    batch: CheckedBatch,
    source: StorageEntry,
  ): Promise<StorageBatchResult> {
    const failures: StorageBatchFailure[] = [];
    let succeeded = 0;
    let stop: StorageErrorCode | null = null;

    for (const ref of batch.refs) {
      // Entries run one after another, so Drive sees no burst of changes.
      const code: StorageErrorCode | null =
        stop ?? (await this.runEntry(session, batch, source, ref));

      if (code === null) {
        succeeded += 1;
        continue;
      }

      failures.push({ code, ref });

      if (STOPPING_CODES.includes(code)) stop = code;
    }

    return { action: batch.action, failures, succeeded };
  }

  /** Changes one entry; returns `null` on success, else the reason. */
  private async runEntry(
    session: StorageSession,
    batch: CheckedBatch,
    source: StorageEntry,
    ref: string,
  ): Promise<StorageErrorCode | null> {
    const entry = await readLiveEntry(this.drive, session, ref);

    if (!entry.ok) return entry.error.code;
    if (entry.value.parentRef !== source.ref) return "invalid_reference";

    const result = await this.change(batch, entry.value);

    return result.ok ? null : result.error.code;
  }

  private async change(
    batch: CheckedBatch,
    entry: StorageEntry,
  ): Promise<StorageResult<unknown>> {
    const target = batch.targetParentRef ?? "";

    if (batch.action === "copy") {
      return entry.isFolder
        ? storageFailure("is_folder")
        : this.writer.copy({
            name: null,
            onConflict: "keep_both",
            ref: entry.ref,
            targetParentRef: target,
            userId: batch.userId,
          });
    }

    if (batch.action === "move") {
      return this.writer.move({
        onConflict: "keep_both",
        ref: entry.ref,
        targetParentRef: target,
        userId: batch.userId,
      });
    }

    return this.trash(batch, entry);
  }

  private async trash(
    batch: CheckedBatch,
    entry: StorageEntry,
  ): Promise<StorageResult<unknown>> {
    let confirmation: string | null = null;

    if (entry.isFolder) {
      const issued = await this.writer.confirm({
        action: "delete",
        ref: entry.ref,
        userId: batch.userId,
      });

      if (!issued.ok) return issued;

      confirmation = issued.value.token;
    }

    return this.writer.trash({
      confirmation,
      ref: entry.ref,
      userId: batch.userId,
    });
  }
}
