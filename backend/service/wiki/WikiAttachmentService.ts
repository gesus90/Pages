import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";
import { countCharacters, WIKI_LIMITS } from "@/definition/Wiki";

import { canManagePage } from "./WikiAccess";
import { detectFileType, sanitizeFileName } from "./WikiFileTypes";
import { WikiPageReader } from "./WikiPageReader";

import type { ReadStream } from "node:fs";
import type {
  StoredWikiAttachment,
  WikiRepository,
} from "@/backend/database/repositories/WikiRepository";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type { User } from "@/definition/User";
import type { WikiAttachment } from "@/definition/Wiki";
import type { DetectedFileType } from "./WikiFileTypes";
import type { WikiAccess } from "./WikiAccess";
import type { WikiSettingsService } from "./WikiSettingsService";

/** An uploaded file as the server receives it. */
export interface UploadedFile {
  /** Name the browser sent; cleaned before it is stored. */
  readonly fileName: string;
  /** Size announced by the request, when it announced one. */
  readonly contentLength: number | null;
  readonly body: AsyncIterable<Uint8Array>;
}

/** A stored file ready to be sent to the browser. */
export interface OpenedAttachment {
  readonly attachment: WikiAttachment;
  readonly stream: ReadStream;
}

/** Files younger than this are never swept; an upload may still be running. */
const SWEEP_AGE_MILLISECONDS = 60 * 60 * 1000;

function toPublic(attachment: StoredWikiAttachment): WikiAttachment {
  return {
    contentType: attachment.contentType,
    createdAt: attachment.createdAt,
    fileName: attachment.fileName,
    id: attachment.id,
    isEmbeddable: isEmbeddableType(attachment.contentType, attachment.kind),
    kind: attachment.kind,
    pageId: attachment.pageId,
    size: attachment.size,
    uploadedBy: attachment.uploadedBy,
    uploadedByName: attachment.uploadedByName,
  };
}

function isEmbeddableType(
  contentType: string,
  kind: "media" | "file",
): boolean {
  return kind === "media" && /^image\/(?:jpeg|png|gif|webp)$/.test(contentType);
}

/** Attaches files to pages, lists them and serves them back. */
export class WikiAttachmentService {
  private readonly repository: WikiRepository;
  private readonly access: WikiAccess;
  private readonly settings: WikiSettingsService;
  private readonly files: WikiFileStore;

  /**
   * Creates the service.
   *
   * @param repository - Wiki persistence.
   * @param access - Resolves who is acting.
   * @param settings - Provides the upload limits.
   * @param files - Keeps the files on the disk.
   */
  public constructor(
    repository: WikiRepository,
    access: WikiAccess,
    settings: WikiSettingsService,
    files: WikiFileStore,
  ) {
    this.repository = repository;
    this.access = access;
    this.settings = settings;
    this.files = files;
  }

  /**
   * Attaches an uploaded file to a page.
   *
   * @param actor - The signed-in user; they need the capability "write".
   * @param pageId - Page identifier.
   * @param file - The upload.
   * @returns The attachment.
   * @throws {WikiAccessDeniedError} Without the capability "write".
   * @throws {WikiPageNotFoundError} When the page is missing or hidden.
   * @throws {WikiValidationError} For an empty file, a file name that is too
   * long, or a file above the limit of its kind.
   *
   * @remarks
   * The type is found from the first bytes, not from the name, and decides
   * the limit (media or other file). The limit is enforced while the bytes
   * stream in, so an upload above it stops and leaves nothing on the disk.
   */
  public async upload(
    actor: User,
    pageId: string,
    file: UploadedFile,
  ): Promise<WikiAttachment> {
    const viewer = await this.access.resolve(actor);

    if (!viewer.canWrite) {
      throw new WikiAccessDeniedError();
    }

    await new WikiPageReader(this.repository).require(viewer.scope, pageId);

    const fileName = sanitizeFileName(file.fileName);

    if (countCharacters(fileName) > WIKI_LIMITS.fileNameLength) {
      throw new WikiValidationError("fileNameTooLong");
    }

    const limits = await this.settings.get();
    const absoluteLimit = Math.max(
      limits.mediaLimitBytes,
      limits.fileLimitBytes,
    );

    if (file.contentLength !== null && file.contentLength > absoluteLimit) {
      throw new WikiValidationError("fileTooLarge");
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
          ? new WikiValidationError("fileTooLarge")
          : error;
      });

    if (stored.size === 0) {
      await this.files.remove([stored.storageName]);

      throw new WikiValidationError("fileEmpty");
    }

    try {
      const draft = {
        checksum: stored.checksum,
        contentType: type.contentType,
        fileName,
        kind: type.kind,
        pageId,
        size: stored.size,
        storageName: stored.storageName,
        uploadedBy: actor.id,
      };
      const created = await this.repository.attachments.insert(draft);

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
   * Lists the attachments of a page.
   *
   * @param actor - The signed-in user.
   * @param pageId - Page identifier.
   * @returns The attachments, oldest first.
   * @throws {WikiPageNotFoundError} When the page is missing or hidden.
   */
  public async list(actor: User, pageId: string): Promise<WikiAttachment[]> {
    const viewer = await this.access.resolve(actor);

    await new WikiPageReader(this.repository).require(viewer.scope, pageId);

    return (await this.repository.attachments.listByPage(pageId)).map(toPublic);
  }

  /**
   * Opens an attachment for download.
   *
   * @param actor - The signed-in user.
   * @param id - Attachment identifier.
   * @returns The attachment and its bytes.
   * @throws {WikiPageNotFoundError} When the attachment does not exist or its
   * page is hidden; both look the same.
   */
  public async open(actor: User, id: string): Promise<OpenedAttachment> {
    const viewer = await this.access.resolve(actor);
    const stored = await this.repository.attachments.find(id);

    if (!stored) {
      throw new WikiPageNotFoundError();
    }

    await new WikiPageReader(this.repository).require(
      viewer.scope,
      stored.pageId,
    );

    return {
      attachment: toPublic(stored),
      stream: this.files.open(stored.storageName),
    };
  }

  /**
   * Removes an attachment and its file.
   *
   * @param actor - The signed-in user; the uploader or whoever manages the page.
   * @param id - Attachment identifier.
   * @throws {WikiAccessDeniedError} For everybody else.
   * @throws {WikiPageNotFoundError} When the attachment or page is not visible.
   */
  public async remove(actor: User, id: string): Promise<void> {
    const viewer = await this.access.resolve(actor);
    const stored = await this.repository.attachments.find(id);

    if (!stored) {
      throw new WikiPageNotFoundError();
    }

    const page = await new WikiPageReader(this.repository).require(
      viewer.scope,
      stored.pageId,
    );

    if (stored.uploadedBy !== actor.id && !canManagePage(viewer, page)) {
      throw new WikiAccessDeniedError();
    }

    await this.repository.attachments.delete(id);
    await this.files.remove([stored.storageName]);
  }

  /**
   * Removes stored files, for example those of pages deleted for good.
   *
   * @param storageNames - Names the file store gave the files.
   */
  public async removeFiles(storageNames: readonly string[]): Promise<void> {
    await this.files.remove(storageNames);
  }

  /**
   * Removes files that no attachment refers to any more, such as the files of
   * a deleted project or of an upload that was cut off.
   *
   * @returns How many files were removed.
   */
  public async sweep(): Promise<number> {
    return this.files.sweep(
      new Set(await this.repository.attachments.listStorageNames()),
      SWEEP_AGE_MILLISECONDS,
    );
  }
}
