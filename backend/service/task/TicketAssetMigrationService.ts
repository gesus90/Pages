import { constants } from "node:fs";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  isTicketAssetPath,
  TicketFileStore,
} from "@/backend/storage/TicketFileStore";

import type { TicketAssetMigrationRepository } from "@/backend/database/repositories/task/TicketAssetMigrationRepository";
import type { StoredWorkItemAttachment } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";

/** Durable record of both paths; the backup keeps the original database and every data file. */
export interface TicketAssetMigrationEntry {
  readonly id: string;
  readonly oldStorageName: string;
  readonly storageName: string;
  readonly checksum: string;
  readonly size: number;
  readonly contentType: string;
  readonly kind: "media" | "file";
}

interface MigrationManifest {
  readonly directory: string;
  readonly entries: readonly TicketAssetMigrationEntry[];
}

/** Performs an explicit offline copy, verify, metadata-commit, remove migration without a schema change. */
export class TicketAssetMigrationService {
  private readonly repository: TicketAssetMigrationRepository;
  private readonly directory: string;
  private readonly backupDirectory: string;
  private readonly files: TicketFileStore;

  public constructor(
    repository: TicketAssetMigrationRepository,
    directory: string,
    backupDirectory: string,
  ) {
    this.repository = repository;
    this.directory = path.resolve(directory);
    this.backupDirectory = path.resolve(backupDirectory);
    this.files = new TicketFileStore(this.directory);
    if (
      this.backupDirectory === this.directory ||
      this.backupDirectory.startsWith(`${this.directory}${path.sep}`)
    )
      throw new Error("The backup must be outside the Pages data directory.");
  }

  /** Refuses every inconsistency before moving originals; repeat with the same backup after interruption. */
  public async migrate(): Promise<{
    readonly attachmentCount: number;
    readonly movedCount: number;
    readonly backupDirectory: string | null;
    readonly entries: readonly TicketAssetMigrationEntry[];
  }> {
    const previous = await this.readManifest();
    const attachments = await this.repository.attachments();
    const entries: TicketAssetMigrationEntry[] = [];
    for (const attachment of attachments)
      entries.push(await this.planEntry(attachment));
    await this.requireCompleteLegacyStore(entries, previous);
    await this.requireCompleteAssetStore(entries);
    const pending = entries.filter(
      (entry) => entry.oldStorageName !== entry.storageName,
    );
    if (pending.length === 0) {
      await this.removeVerifiedOriginals(previous?.entries ?? [], entries);
      return {
        attachmentCount: entries.length,
        movedCount: 0,
        backupDirectory: previous ? this.backupDirectory : null,
        entries,
      };
    }
    if (previous) this.requireMatchingManifest(previous, entries);
    else await this.backup(entries);
    await this.copyDestinations(pending);
    await this.verifyDestinations(entries);
    await this.repository.relocate(pending);
    await this.verifyMetadata(entries);
    await this.verifyDestinations(entries);
    await this.removeVerifiedOriginals(entries, entries);
    return {
      attachmentCount: entries.length,
      movedCount: pending.length,
      backupDirectory: this.backupDirectory,
      entries,
    };
  }

  private async planEntry(
    attachment: StoredWorkItemAttachment,
  ): Promise<TicketAssetMigrationEntry> {
    const inspected = await this.files.inspect(attachment.storageName);
    if (
      inspected.checksum !== attachment.checksum ||
      inspected.size !== attachment.size
    )
      throw new Error(
        `Attachment ${attachment.id}: size or checksum mismatch; migration aborted.`,
      );
    const storageName = `assets/${attachment.workItemId}/${attachment.id}.${inspected.type.extension}`;
    if (!isTicketAssetPath(storageName))
      throw new Error(`Attachment ${attachment.id}: invalid identifier.`);
    if (
      isTicketAssetPath(attachment.storageName) &&
      attachment.storageName !== storageName
    )
      throw new Error(
        `Attachment ${attachment.id}: unexpected destination path.`,
      );
    return {
      id: attachment.id,
      oldStorageName: attachment.storageName,
      storageName,
      checksum: inspected.checksum,
      size: inspected.size,
      contentType: inspected.type.contentType,
      kind: inspected.type.kind,
    };
  }

  private async readManifest(): Promise<MigrationManifest | null> {
    try {
      const content: unknown = JSON.parse(
        await readFile(
          path.join(this.backupDirectory, "ticket-assets-manifest.json"),
          "utf8",
        ),
      );
      if (!isManifest(content) || content.directory !== this.directory)
        throw new Error(
          "Invalid migration manifest or different data directory.",
        );
      return content;
    } catch (error: unknown) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private requireMatchingManifest(
    previous: MigrationManifest,
    entries: readonly TicketAssetMigrationEntry[],
  ): void {
    const expected = new Map(
      previous.entries.map((entry) => [entry.id, entry]),
    );
    if (expected.size !== entries.length)
      throw new Error(
        "Attachment count changed since backup; migration aborted.",
      );
    for (const entry of entries) {
      const original = expected.get(entry.id);
      if (
        !original ||
        original.storageName !== entry.storageName ||
        original.checksum !== entry.checksum ||
        original.size !== entry.size
      )
        throw new Error(
          `Attachment ${entry.id}: differs from backup manifest; migration aborted.`,
        );
    }
  }

  private async requireCompleteLegacyStore(
    entries: readonly TicketAssetMigrationEntry[],
    previous: MigrationManifest | null,
  ): Promise<void> {
    const known = new Set(
      [...entries, ...(previous?.entries ?? [])].map(
        (entry) => entry.oldStorageName,
      ),
    );
    const names = await readdir(
      path.join(this.directory, "ticket-attachments"),
      { withFileTypes: true },
    ).catch((error: unknown) => {
      if (isMissing(error)) return [];
      throw error;
    });
    const orphans = names.filter(
      (entry) => !entry.isFile() || !known.has(entry.name),
    );
    if (orphans.length > 0)
      throw new Error(
        `Files without attachment records (not deleted): ${orphans.map((entry) => entry.name).join(", ")}`,
      );
  }

  private async requireCompleteAssetStore(
    entries: readonly TicketAssetMigrationEntry[],
  ): Promise<void> {
    const root = path.join(this.directory, "assets");
    const tickets = await readdir(root, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (isMissing(error)) return [];
        throw error;
      },
    );
    const known = new Set(entries.map((entry) => entry.storageName));
    const orphans: string[] = [];
    for (const ticket of tickets) {
      if (!ticket.isDirectory()) {
        orphans.push(`assets/${ticket.name}`);
        continue;
      }
      for (const file of await readdir(path.join(root, ticket.name), {
        withFileTypes: true,
      })) {
        const relative = `assets/${ticket.name}/${file.name}`;
        if (!file.isFile() || !known.has(relative)) orphans.push(relative);
      }
    }
    if (orphans.length > 0)
      throw new Error(
        `Files without attachment records (not deleted): ${orphans.join(", ")}`,
      );
  }

  private async verifyMetadata(
    entries: readonly TicketAssetMigrationEntry[],
  ): Promise<void> {
    const attachments = await this.repository.attachments();
    const expected = new Map(entries.map((entry) => [entry.id, entry]));
    if (attachments.length !== expected.size)
      throw new Error("Attachment count changed; originals retained.");
    for (const attachment of attachments) {
      const entry = expected.get(attachment.id);
      if (
        !entry ||
        attachment.storageName !== entry.storageName ||
        attachment.checksum !== entry.checksum ||
        attachment.size !== entry.size
      )
        throw new Error(
          `Metadata mismatch for ${attachment.id}; originals retained.`,
        );
    }
  }

  private async backup(
    entries: readonly TicketAssetMigrationEntry[],
  ): Promise<void> {
    await this.repository.checkpoint();
    await mkdir(this.backupDirectory, { recursive: false });
    const backupData = path.join(this.backupDirectory, "data");
    await cp(this.directory, backupData, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const backupFiles = new TicketFileStore(backupData);
    for (const entry of entries) {
      const copied = await backupFiles.inspect(entry.oldStorageName);
      if (copied.checksum !== entry.checksum || copied.size !== entry.size)
        throw new Error(
          `Backup verification failed for ${entry.id}. No originals moved.`,
        );
    }
    await writeFile(
      path.join(this.backupDirectory, "ticket-assets-manifest.json"),
      JSON.stringify({ directory: this.directory, entries }, null, 2),
      { flag: "wx" },
    );
  }

  private async copyDestinations(
    entries: readonly TicketAssetMigrationEntry[],
  ): Promise<void> {
    for (const entry of entries) {
      const target = path.join(this.directory, entry.storageName);
      await mkdir(path.dirname(target), { recursive: true });
      try {
        await copyFile(
          path.join(this.directory, "ticket-attachments", entry.oldStorageName),
          target,
          constants.COPYFILE_EXCL,
        );
      } catch (error: unknown) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ))
          throw error;
        // An interrupted copy is reusable only after every destination passes verification.
      }
    }
  }

  private async verifyDestinations(
    entries: readonly TicketAssetMigrationEntry[],
  ): Promise<void> {
    for (const entry of entries) {
      const inspected = await this.files.inspect(entry.storageName);
      if (
        inspected.size !== entry.size ||
        inspected.checksum !== entry.checksum
      )
        throw new Error(
          `Destination mismatch for ${entry.id}; originals retained.`,
        );
    }
  }

  private async removeVerifiedOriginals(
    originals: readonly TicketAssetMigrationEntry[],
    current: readonly TicketAssetMigrationEntry[],
  ): Promise<void> {
    const byId = new Map(current.map((entry) => [entry.id, entry]));
    for (const original of originals) {
      const entry = byId.get(original.id);
      if (
        original.oldStorageName === original.storageName ||
        !entry ||
        entry.checksum !== original.checksum ||
        entry.storageName !== original.storageName
      )
        continue;
      const oldPath = path.join(
        this.directory,
        "ticket-attachments",
        original.oldStorageName,
      );
      const exists = await lstat(oldPath).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (!exists) continue;
      const inspected = await this.files.inspect(original.oldStorageName);
      if (
        inspected.checksum !== entry.checksum ||
        inspected.size !== entry.size
      )
        throw new Error(`Original changed for ${entry.id}; retained.`);
      await this.files.remove([original.oldStorageName]);
    }
    // Keep the now-empty legacy directory harmlessly; unknown files are never swept.
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isManifest(content: unknown): content is MigrationManifest {
  if (
    typeof content !== "object" ||
    content === null ||
    !("directory" in content) ||
    typeof content.directory !== "string" ||
    !("entries" in content) ||
    !Array.isArray(content.entries)
  )
    return false;
  return content.entries.every(isManifestEntry);
}

function isManifestEntry(entry: unknown): entry is TicketAssetMigrationEntry {
  if (typeof entry !== "object" || entry === null) return false;
  return hasMigrationIdentity(entry) && hasMigrationContent(entry);
}

function hasMigrationIdentity(entry: object): boolean {
  return (
    "id" in entry &&
    typeof entry.id === "string" &&
    "storageName" in entry &&
    typeof entry.storageName === "string" &&
    isTicketAssetPath(entry.storageName) &&
    "oldStorageName" in entry &&
    typeof entry.oldStorageName === "string" &&
    /^(?:[0-9a-f-]{36}|assets\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]+)$/i.test(
      entry.oldStorageName,
    )
  );
}

function hasMigrationContent(entry: object): boolean {
  return (
    "checksum" in entry &&
    typeof entry.checksum === "string" &&
    /^[0-9a-f]{64}$/.test(entry.checksum) &&
    "contentType" in entry &&
    typeof entry.contentType === "string" &&
    "kind" in entry &&
    (entry.kind === "media" || entry.kind === "file") &&
    "size" in entry &&
    typeof entry.size === "number" &&
    Number.isSafeInteger(entry.size) &&
    entry.size >= 0
  );
}
