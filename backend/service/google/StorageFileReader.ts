import {
  GOOGLE_EXPORT_FORMATS,
  GOOGLE_READ_FORMATS,
  isGoogleAppsType,
} from "@/backend/google/GoogleDriveFormats";
import { escapeDriveLiteral } from "@/backend/google/GoogleDriveItemsClient";
import {
  driveFailure,
  isStorageRef,
  openStorageSession,
  readLiveEntry,
  readLiveFolder,
  storageFailure,
} from "@/backend/service/google/StorageFileSupport";
import { STORAGE_SHARED_DRIVES_ID } from "@/definition/GoogleDriveStorage";

import type { DriveMedia } from "@/backend/google/GoogleDriveItemsClient";
import type {
  StorageConnection,
  StorageDriveClient,
  StorageSession,
} from "@/backend/service/google/StorageFileSupport";
import type {
  StorageEntry,
  StorageEntryPage,
  StorageQuotaReading,
  StorageReadContent,
  StorageResult,
} from "@/definition/GoogleDriveFiles";

/** The most entries one page may ask for; Drive allows no more. */
export const STORAGE_PAGE_SIZE_LIMIT = 1000;

/** The default page size of `list` and `search`. */
const DEFAULT_PAGE_SIZE = 100;

/** The most bytes `read` returns inline; larger files go through `download`. */
export const STORAGE_MAX_READ_BYTES = 1024 * 1024;

const MAXIMUM_PATH_STEPS = 30;
const MAXIMUM_SEARCH_LENGTH = 200;

/** File types `read` returns as text besides `text/*`. */
const TEXT_TYPES = [
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "image/svg+xml",
];

/** File name extensions of export formats, for the download name. */
const EXPORT_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    ".pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "text/csv": ".csv",
  "text/html": ".html",
  "text/markdown": ".md",
  "text/plain": ".txt",
};

/** What a listing asks for. */
export interface StorageListRequest {
  /** The folder; `root` for My Drive, `shared-drives` for the shared drives. */
  readonly ref: string;
  readonly pageToken: string | null;
  readonly pageSize: number | null;
  /** Lists the trash instead of a folder: entries put there themselves. */
  readonly isTrash: boolean;
}

/** A listed folder and one page of its content. */
export interface StorageListing extends StorageEntryPage {
  /** The listed folder; `null` for the trash and the shared-drive list. */
  readonly folder: StorageEntry | null;
}

/** What a search asks for. */
export interface StorageSearchRequest {
  readonly text: string;
  /** Restricts the search to the direct content of one folder. */
  readonly folderRef: string | null;
  readonly pageToken: string | null;
  readonly pageSize: number | null;
}

/** An entry with its readable path. */
export interface StorageLocatedEntry {
  readonly entry: StorageEntry;
  /** `/Ordner/Datei` in My Drive, `/shared-drives/<Name>/…` in a shared drive, `…/` when a parent is not visible. */
  readonly path: string;
}

/** A download ready to stream. */
export interface StorageDownload {
  readonly entry: StorageEntry;
  readonly fileName: string;
  readonly media: DriveMedia;
}

function pageSizeOf(requested: number | null): number {
  if (requested === null || !Number.isInteger(requested) || requested < 1) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(requested, STORAGE_PAGE_SIZE_LIMIT);
}

function isTextType(mimeType: string): boolean {
  const base = mimeType.split(";")[0]?.trim() ?? "";

  return base.startsWith("text/") || TEXT_TYPES.includes(base);
}

function readPathSteps(path: string): string[] | null {
  if (!path.startsWith("/") || path.length > 4096) {
    return null;
  }

  const steps = path.split("/").filter((step) => step !== "");

  return steps.length <= MAXIMUM_PATH_STEPS &&
    steps.every((step) => step !== "." && step !== "..")
    ? steps
    : null;
}

async function readLimited(
  media: DriveMedia,
  limitBytes: number,
): Promise<Buffer | null> {
  if (media.sizeBytes !== null && media.sizeBytes > limitBytes) {
    await media.body?.cancel();

    return null;
  }

  const reader = media.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let chunk = await reader?.read();

  while (reader && chunk && !chunk.done) {
    length += chunk.value.length;

    if (length > limitBytes) {
      await reader.cancel();

      return null;
    }

    chunks.push(chunk.value);
    chunk = await reader.read();
  }

  return Buffer.concat(chunks);
}

/**
 * The reading operations of the Storage interface (PAGE-270): list, search,
 * stat, resolve_path, read, download, quota.
 *
 * @remarks
 * Each call takes a freshly confirmed access of the instance connection, so
 * Google decides with the rights of the bound account; nothing is cached.
 */
export class StorageFileReader {
  private readonly connection: StorageConnection;
  private readonly drive: StorageDriveClient;

  /**
   * Creates the reader.
   *
   * @param connection - The Drive connection.
   * @param drive - The Drive client.
   */
  public constructor(connection: StorageConnection, drive: StorageDriveClient) {
    this.connection = connection;
    this.drive = drive;
  }

  /**
   * Lists one page of a folder, of the shared drives or of the trash.
   *
   * @param request - Folder, page and page size.
   * @returns The folder and the page.
   */
  public async list(
    request: StorageListRequest,
  ): Promise<StorageResult<StorageListing>> {
    const session = await openStorageSession(this.connection);

    if (!session.ok) return session;

    if (request.isTrash) return this.listTrash(session.value, request);
    if (request.ref === STORAGE_SHARED_DRIVES_ID) {
      return this.listSharedDrives(session.value, request);
    }

    const folder = await readLiveFolder(this.drive, session.value, request.ref);

    if (!folder.ok) return folder;

    const page = await this.drive.query(session.value.accessToken, {
      driveId: folder.value.driveRef,
      pageSize: pageSizeOf(request.pageSize),
      pageToken: request.pageToken,
      query: `'${folder.value.ref}' in parents and trashed = false`,
    });

    return page.ok
      ? { ok: true, value: { ...page.value, folder: folder.value } }
      : driveFailure(page);
  }

  /**
   * Searches entries by name outside the trash.
   *
   * @param request - Text, optional folder, page and page size.
   * @returns One page of matches.
   */
  public async search(
    request: StorageSearchRequest,
  ): Promise<StorageResult<StorageEntryPage>> {
    const text = request.text.trim();

    if (text === "" || text.length > MAXIMUM_SEARCH_LENGTH) {
      return storageFailure("invalid_request");
    }

    if (request.folderRef !== null && !isStorageRef(request.folderRef)) {
      return storageFailure("invalid_reference");
    }

    const session = await openStorageSession(this.connection);

    if (!session.ok) return session;

    const folderClause =
      request.folderRef === null
        ? ""
        : ` and '${request.folderRef}' in parents`;
    const page = await this.drive.query(session.value.accessToken, {
      driveId: null,
      pageSize: pageSizeOf(request.pageSize),
      pageToken: request.pageToken,
      query: `name contains '${escapeDriveLiteral(text)}' and trashed = false${folderClause}`,
    });

    return page.ok ? page : driveFailure(page);
  }

  /**
   * Reads the metadata of an entry, also one in the trash.
   *
   * @param ref - The reference.
   * @returns The entry with its readable path.
   */
  public async stat(ref: string): Promise<StorageResult<StorageLocatedEntry>> {
    if (!isStorageRef(ref)) {
      return storageFailure("invalid_reference");
    }

    const session = await openStorageSession(this.connection);

    if (!session.ok) return session;

    const entry = await this.drive.stat(session.value.accessToken, ref);

    if (!entry.ok) return driveFailure(entry);

    return {
      ok: true,
      value: {
        entry: entry.value,
        path: await this.readablePath(session.value, entry.value),
      },
    };
  }

  /**
   * Resolves a readable path into the direct reference of its entry.
   *
   * @param path - `/Ordner/Datei` from My Drive or `/shared-drives/<Name>/…`.
   * @returns The entry; `ambiguous_path` names every candidate of a step
   * whose name several entries share.
   */
  public async resolvePath(
    path: string,
  ): Promise<StorageResult<StorageLocatedEntry>> {
    const steps = readPathSteps(path);

    if (steps === null) {
      return storageFailure("invalid_path");
    }

    const session = await openStorageSession(this.connection);

    if (!session.ok) return session;

    const start = await this.pathStart(session.value, steps);

    if (!start.ok) return start;

    let current = start.value.entry;

    for (const step of start.value.rest) {
      if (!current.isFolder) return storageFailure("not_folder");

      const next = await this.childNamed(session.value, current, step);

      if (!next.ok) return next;

      current = next.value;
    }

    return {
      ok: true,
      value: {
        entry: current,
        path: await this.readablePath(session.value, current),
      },
    };
  }

  /**
   * Returns the text of a file or the text export of a Google document, limited in size.
   *
   * @param ref - The reference.
   * @param format - An export format for a Google document, else `null`.
   * @returns The text; binary files and large files are refused for `download`.
   */
  public async read(
    ref: string,
    format: string | null,
  ): Promise<StorageResult<StorageReadContent>> {
    const session = await openStorageSession(this.connection);

    if (!session.ok) return session;

    const entry = await readLiveEntry(this.drive, session.value, ref);

    if (!entry.ok) return entry;
    if (entry.value.isFolder) return storageFailure("is_folder");

    const mimeType = this.readFormat(entry.value, format);

    if (mimeType === null || !isTextType(mimeType)) {
      return storageFailure("unsupported_operation", {
        exportFormats: entry.value.exportFormats.filter(isTextType),
      });
    }

    if ((entry.value.sizeBytes ?? 0) > STORAGE_MAX_READ_BYTES) {
      return storageFailure("too_large", {
        limitBytes: STORAGE_MAX_READ_BYTES,
      });
    }

    const media = await this.open(session.value, entry.value, mimeType);

    if (!media.ok) return media;

    const bytes = await readLimited(media.value.media, STORAGE_MAX_READ_BYTES);

    return bytes === null
      ? storageFailure("too_large", { limitBytes: STORAGE_MAX_READ_BYTES })
      : {
          ok: true,
          value: { entry: entry.value, mimeType, text: bytes.toString("utf8") },
        };
  }

  /**
   * Opens the bytes of a file, or of a Google document in a supported export format, as a stream.
   *
   * @param ref - The reference.
   * @param format - The export format a Google document needs, else `null`.
   * @returns The stream with its type and file name.
   */
  public async download(
    ref: string,
    format: string | null,
  ): Promise<StorageResult<StorageDownload>> {
    const session = await openStorageSession(this.connection);

    if (!session.ok) return session;

    const entry = await readLiveEntry(this.drive, session.value, ref);

    if (!entry.ok) return entry;
    if (entry.value.isFolder) return storageFailure("is_folder");

    const isGoogle = isGoogleAppsType(entry.value.mimeType);
    const mimeType = isGoogle ? format : entry.value.mimeType;

    if (
      mimeType === null ||
      (isGoogle && !entry.value.exportFormats.includes(mimeType))
    ) {
      return storageFailure("unsupported_operation", {
        exportFormats: entry.value.exportFormats,
      });
    }

    return this.open(session.value, entry.value, mimeType);
  }

  /**
   * Reads the storage quota with `about.get`.
   *
   * @returns Use, use in Drive and in the trash, and the limit.
   */
  public async quota(): Promise<StorageResult<StorageQuotaReading>> {
    const session = await openStorageSession(this.connection);

    if (!session.ok) return session;

    const quota = await this.drive.readQuota(session.value.accessToken);

    return quota.ok ? quota : driveFailure(quota);
  }

  /**
   * Builds the readable path of an entry from its parents.
   *
   * @param session - The access of the call.
   * @param entry - The entry.
   * @returns The path; `…` stands for parents the account cannot see.
   */
  public async readablePath(
    session: StorageSession,
    entry: StorageEntry,
  ): Promise<string> {
    const names: string[] = [];
    let current = entry;

    for (let depth = 0; depth < MAXIMUM_PATH_STEPS; depth += 1) {
      if (current.parentRef === null) {
        return this.rootPrefix(current, names);
      }

      names.unshift(current.name);

      const parent = await this.drive.stat(
        session.accessToken,
        current.parentRef,
      );

      if (!parent.ok) break;

      current = parent.value;
    }

    return `…/${names.join("/")}`;
  }

  private rootPrefix(root: StorageEntry, names: readonly string[]): string {
    if (root.driveRef !== null && root.ref === root.driveRef) {
      return `/${STORAGE_SHARED_DRIVES_ID}/${[root.name, ...names].join("/")}`;
    }

    return `/${names.join("/")}`;
  }

  private readFormat(
    entry: StorageEntry,
    format: string | null,
  ): string | null {
    if (!isGoogleAppsType(entry.mimeType)) {
      return entry.mimeType;
    }

    const wanted = format ?? GOOGLE_READ_FORMATS[entry.mimeType] ?? null;

    return wanted !== null &&
      (GOOGLE_EXPORT_FORMATS[entry.mimeType] ?? []).includes(wanted)
      ? wanted
      : null;
  }

  private async open(
    session: StorageSession,
    entry: StorageEntry,
    mimeType: string,
  ): Promise<StorageResult<StorageDownload>> {
    const isGoogle = isGoogleAppsType(entry.mimeType);
    const media = isGoogle
      ? await this.drive.export(session.accessToken, entry.ref, mimeType)
      : await this.drive.download(session.accessToken, entry.ref);

    if (!media.ok) return driveFailure(media);

    const extension = isGoogle ? (EXPORT_EXTENSIONS[mimeType] ?? "") : "";

    return {
      ok: true,
      value: {
        entry,
        fileName: `${entry.name}${extension}`,
        media: media.value,
      },
    };
  }

  private async listTrash(
    session: StorageSession,
    request: StorageListRequest,
  ): Promise<StorageResult<StorageListing>> {
    const page = await this.drive.query(session.accessToken, {
      driveId: null,
      pageSize: pageSizeOf(request.pageSize),
      pageToken: request.pageToken,
      query: "trashed = true",
    });

    if (!page.ok) return driveFailure(page);

    return {
      ok: true,
      value: {
        entries: page.value.entries.filter(
          (entry) => entry.isExplicitlyTrashed,
        ),
        folder: null,
        nextPageToken: page.value.nextPageToken,
      },
    };
  }

  private async listSharedDrives(
    session: StorageSession,
    request: StorageListRequest,
  ): Promise<StorageResult<StorageListing>> {
    const page = await this.drive.listSharedDrives(session.accessToken, {
      pageSize: pageSizeOf(request.pageSize),
      pageToken: request.pageToken,
    });

    return page.ok
      ? { ok: true, value: { ...page.value, folder: null } }
      : driveFailure(page);
  }

  private async pathStart(
    session: StorageSession,
    steps: readonly string[],
  ): Promise<
    StorageResult<{
      readonly entry: StorageEntry;
      readonly rest: readonly string[];
    }>
  > {
    const [first, driveName, ...rest] = steps;

    if (first !== STORAGE_SHARED_DRIVES_ID) {
      const root = await readLiveEntry(this.drive, session, "root");

      return root.ok
        ? { ok: true, value: { entry: root.value, rest: steps } }
        : root;
    }

    if (driveName === undefined) {
      return storageFailure("invalid_path");
    }

    const drives = await this.drive.listSharedDrives(session.accessToken, {
      pageSize: 100,
      pageToken: null,
    });

    if (!drives.ok) return driveFailure(drives);

    const matches = drives.value.entries.filter(
      (entry) => entry.name === driveName,
    );
    const [match] = matches;

    if (!match) return storageFailure("not_found");
    if (matches.length > 1)
      return storageFailure("ambiguous_path", { candidates: matches });

    const root = await readLiveEntry(this.drive, session, match.ref);

    return root.ok ? { ok: true, value: { entry: root.value, rest } } : root;
  }

  private async childNamed(
    session: StorageSession,
    folder: StorageEntry,
    name: string,
  ): Promise<StorageResult<StorageEntry>> {
    const page = await this.drive.query(session.accessToken, {
      driveId: folder.driveRef,
      pageSize: 20,
      pageToken: null,
      query: `'${folder.ref}' in parents and name = '${escapeDriveLiteral(name)}' and trashed = false`,
    });

    if (!page.ok) return driveFailure(page);

    const [match, ...others] = page.value.entries;

    if (!match) return storageFailure("not_found");

    return others.length > 0
      ? storageFailure("ambiguous_path", { candidates: page.value.entries })
      : { ok: true, value: match };
  }
}
