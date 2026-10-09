import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import {
  detectFileType,
  isEmbeddableType,
  sanitizeFileName,
} from "@/backend/service/wiki/WikiFileTypes";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";
import { countCharacters, WIKI_LIMITS } from "@/definition/Wiki";

import type { ReadStream } from "node:fs";
import type {
  StoredWorkItemAttachment,
  WorkItemAttachmentRepository,
} from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import type { UploadedFile } from "@/backend/service/wiki/WikiAttachmentService";
import type { DetectedFileType } from "@/backend/service/wiki/WikiFileTypes";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type {
  TaskActionPermissions,
  WorkItemAttachment,
  WorkItemDetail,
} from "@/definition/Task";
import type { User } from "@/definition/User";

/** The ticket reads the attachment service needs; each one checks access. */
export interface TicketAccess {
  /** Returns a ticket the actor may see, archived ones included. */
  readonly getById: (actor: User, id: string) => Promise<WorkItemDetail>;
  readonly actionPermissions: (actor: User) => Promise<TaskActionPermissions>;
}

/** The instance-wide upload limits, shared with wiki attachments (the wiki settings). */
export interface UploadLimitSource {
  readonly getSettings: () => Promise<{
    readonly mediaLimitBytes: number;
    readonly fileLimitBytes: number;
  }>;
}

/** A stored ticket attachment ready to be sent to the browser. */
export interface OpenedTicketAttachment {
  readonly attachment: WorkItemAttachment;
  readonly stream: ReadStream;
}

/** Files younger than this are never swept; an upload may still be running. */
const SWEEP_AGE_MILLISECONDS = 60 * 60 * 1000;

function toPublic(attachment: StoredWorkItemAttachment): WorkItemAttachment {
  return {
    contentType: attachment.contentType,
    createdAt: attachment.createdAt,
    fileName: attachment.fileName,
    id: attachment.id,
    isEmbeddable: isEmbeddableType(attachment.contentType, attachment.kind),
    kind: attachment.kind,
    size: attachment.size,
    uploadedBy: attachment.uploadedBy,
    uploadedByName: attachment.uploadedByName,
    workItemId: attachment.workItemId,
  };
}

/**
 * Attaches files to tickets, lists them and serves them back (A8.2).
 *
 * @remarks
 * Files are kept like wiki attachments: the type comes from the first bytes,
 * the limits of the wiki settings apply instance-wide, and the size limit is
 * enforced while the bytes stream in. Reading needs sight of the ticket,
 * uploading and removing need the right to change it.
 */
export class TaskAttachmentService {
  private readonly repository: WorkItemAttachmentRepository;
  private readonly tickets: TicketAccess;
  private readonly limits: UploadLimitSource;
  private readonly files: WikiFileStore;

  /**
   * Creates the service.
   *
   * @param repository - Persistence of the attachment metadata.
   * @param tickets - Ticket reads that check the access of the actor.
   * @param limits - Provides the upload limits.
   * @param files - Keeps the files on the disk.
   */
  public constructor(
    repository: WorkItemAttachmentRepository,
    tickets: TicketAccess,
    limits: UploadLimitSource,
    files: WikiFileStore,
  ) {
    this.repository = repository;
    this.tickets = tickets;
    this.limits = limits;
    this.files = files;
  }

  /**
   * Attaches an uploaded file to a ticket.
   *
   * @param actor - The person uploading; needs the right to change the ticket.
   * @param workItemId - Ticket identifier.
   * @param file - The upload.
   * @returns The attachment.
   * @throws {WorkItemNotFoundError} When the ticket is missing or hidden.
   * @throws {WorkItemAccessDeniedError} Without the right to change tickets.
   * @throws {WorkItemValidationError} For an archived ticket, an empty file,
   * a file name that is too long or a file above its limit.
   */
  public async upload(
    actor: User,
    workItemId: string,
    file: UploadedFile,
  ): Promise<WorkItemAttachment> {
    const ticket = await this.requireWritable(actor, workItemId);
    const fileName = sanitizeFileName(file.fileName);

    if (countCharacters(fileName) > WIKI_LIMITS.fileNameLength) {
      throw new WorkItemValidationError("attachmentFileNameTooLong");
    }

    const limits = await this.limits.getSettings();
    const absoluteLimit = Math.max(
      limits.mediaLimitBytes,
      limits.fileLimitBytes,
    );

    if (file.contentLength !== null && file.contentLength > absoluteLimit) {
      throw new WorkItemValidationError("attachmentTooLarge");
    }

    let type: DetectedFileType = detectFileType(Buffer.alloc(0));
    const stored = await this.files
      .write(file.body, {
        absoluteLimit,
        limitFor: (head) => {
          type = detectFileType(head);

          return type.kind === "media"
            ? limits.mediaLimitBytes
            : limits.fileLimitBytes;
        },
      })
      .catch((error: unknown) => {
        throw error instanceof FileTooLargeError
          ? new WorkItemValidationError("attachmentTooLarge")
          : error;
      });

    if (stored.size === 0) {
      await this.files.remove([stored.storageName]);

      throw new WorkItemValidationError("attachmentFileEmpty");
    }

    const draft = {
      checksum: stored.checksum,
      contentType: type.contentType,
      fileName,
      kind: type.kind,
      size: stored.size,
      storageName: stored.storageName,
      uploadedBy: actor.id,
      workItemId: ticket.id,
    };

    try {
      const created = await this.repository.insert(draft);

      return toPublic({
        ...draft,
        ...created,
        uploadedByName: actor.displayName,
      });
    } catch (error: unknown) {
      await this.files.remove([stored.storageName]);

      throw error;
    }
  }

  /**
   * Lists the attachments of a ticket.
   *
   * @param actor - The person reading.
   * @param workItemId - Ticket identifier.
   * @returns The attachments, oldest first.
   * @throws {WorkItemNotFoundError} When the ticket is missing or hidden.
   */
  public async list(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemAttachment[]> {
    await this.tickets.getById(actor, workItemId);

    return (await this.repository.listByWorkItem(workItemId)).map(toPublic);
  }

  /**
   * Opens an attachment for download.
   *
   * @param actor - The person reading.
   * @param id - Attachment identifier.
   * @returns The attachment and its bytes.
   * @throws {WorkItemNotFoundError} When the attachment does not exist or its
   * ticket is hidden; both look the same.
   */
  public async open(actor: User, id: string): Promise<OpenedTicketAttachment> {
    const stored = await this.requireStored(id);

    await this.tickets.getById(actor, stored.workItemId);

    return {
      attachment: toPublic(stored),
      stream: this.files.open(stored.storageName),
    };
  }

  /**
   * Removes an attachment and its file.
   *
   * @param actor - The person removing; needs the right to change the ticket.
   * @param id - Attachment identifier.
   * @throws {WorkItemNotFoundError} When the attachment or its ticket is not visible.
   * @throws {WorkItemAccessDeniedError} Without the right to change tickets.
   */
  public async remove(actor: User, id: string): Promise<void> {
    const stored = await this.requireStored(id);

    await this.requireWritable(actor, stored.workItemId);
    await this.repository.delete(id);
    await this.files.remove([stored.storageName]);
  }

  /**
   * Removes stored files, for example those of tickets deleted for good.
   *
   * @param storageNames - Names the file store gave the files.
   */
  public async removeFiles(storageNames: readonly string[]): Promise<void> {
    await this.files.remove(storageNames);
  }

  /**
   * Removes files no attachment refers to any more, such as the files of a
   * deleted project or of an upload that was cut off.
   *
   * @returns How many files were removed.
   */
  public async sweep(): Promise<number> {
    return this.files.sweep(
      new Set(await this.repository.listStorageNames()),
      SWEEP_AGE_MILLISECONDS,
    );
  }

  private async requireStored(id: string): Promise<StoredWorkItemAttachment> {
    const stored = await this.repository.find(id);

    if (!stored) {
      throw new WorkItemNotFoundError();
    }

    return stored;
  }

  private async requireWritable(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemDetail> {
    const ticket = await this.tickets.getById(actor, workItemId);

    if (!(await this.tickets.actionPermissions(actor)).canWrite) {
      throw new WorkItemAccessDeniedError();
    }

    if (ticket.archivedAt !== null) {
      throw new WorkItemValidationError("ticketArchived");
    }

    return ticket;
  }
}
