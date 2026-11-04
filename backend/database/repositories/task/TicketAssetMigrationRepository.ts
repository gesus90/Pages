import { WorkItemAttachmentRepository } from "./WorkItemAttachmentRepository";

import type { Database } from "@/backend/database/Database";
import type { StoredWorkItemAttachment } from "./WorkItemAttachmentRepository";

/** Atomic metadata switch after the offline migration has verified all destination files. */
export class TicketAssetMigrationRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Reads every attachment, including attachments of archived tickets. */
  public async attachments(): Promise<StoredWorkItemAttachment[]> {
    return new WorkItemAttachmentRepository(this.database).listAll();
  }

  /** Flushes the database before its locked, filesystem-level backup is taken. */
  public async checkpoint(): Promise<void> {
    // PostgreSQL has no write-ahead log of its own to flush for a file copy, and
    // CHECKPOINT needs rights the Pages role does not hold.
    if (this.database.dialect === "postgres") return;
    await this.database.execute("CHECKPOINT;");
  }

  /** Changes all verified relative paths in one commit. */
  public async relocate(
    attachments: readonly Pick<
      StoredWorkItemAttachment,
      "id" | "storageName" | "contentType" | "kind"
    >[],
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const repository = new WorkItemAttachmentRepository(transaction);
      for (const attachment of attachments)
        await repository.updateStorage(attachment);
    });
    await this.checkpoint();
  }
}
