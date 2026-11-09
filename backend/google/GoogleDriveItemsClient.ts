import { randomBytes } from "node:crypto";

import {
  DRIVE_FOLDER_MIME_TYPE,
  GOOGLE_EXPORT_FORMATS,
} from "@/backend/google/GoogleDriveFormats";
import {
  isRecord,
  readErrorReasons,
  readJson,
  readString,
  sendGoogleRequest,
} from "@/backend/google/GoogleDriveResponses";

import type { GoogleFetch } from "@/backend/google/GoogleDriveResponses";
import type { GoogleDriveProblem } from "@/definition/GoogleDrive";
import type {
  StorageEntry,
  StorageEntryPage,
  StorageErrorCode,
  StorageQuotaReading,
} from "@/definition/GoogleDriveFiles";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
/** A download, export or upload may stream for this long, body included. */
const TRANSFER_TIMEOUT_MS = 30 * 60 * 1000;
const ENTRY_FIELDS =
  "id,name,mimeType,modifiedTime,size,webViewLink,parents,trashed,explicitlyTrashed,driveId,version";

/** A refused Drive request, already in the words of the Storage interface. */
export interface DriveItemFailure {
  readonly ok: false;
  readonly code: StorageErrorCode;
  /** Set when the stored access itself is refused or the Drive API is off. */
  readonly connectionProblem: GoogleDriveProblem | null;
}

/** The outcome of one Drive request. */
export type DriveItemResult<Value> =
  { readonly ok: true; readonly value: Value } | DriveItemFailure;

/** What one listing or search asks for. */
export interface DriveQueryRequest {
  /** A Drive `q` expression built from checked identifiers and escaped literals. */
  readonly query: string;
  readonly driveId: string | null;
  readonly pageToken: string | null;
  readonly pageSize: number;
}

/** Metadata changes of one entry. */
export interface DriveEntryChange {
  readonly name?: string;
  readonly isTrashed?: boolean;
  readonly addParentId?: string;
  readonly removeParentId?: string;
}

/** A new file with its bytes. */
export interface DriveUpload {
  readonly name: string;
  readonly mimeType: string;
  readonly parentId: string;
  readonly content: Uint8Array;
}

/** The bytes of a download or an export, streamed from Drive. */
export interface DriveMedia {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly mimeType: string;
  readonly sizeBytes: number | null;
}

/**
 * Escapes a text for a quoted literal of Drive's `q` syntax.
 *
 * @param text - Untrusted text.
 * @returns The text with backslashes and single quotes escaped.
 */
export function escapeDriveLiteral(text: string): string {
  return text.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'");
}

function failure(
  code: StorageErrorCode,
  connectionProblem: GoogleDriveProblem | null = null,
): DriveItemFailure {
  return { code, connectionProblem, ok: false };
}

const UNSUPPORTED_REASONS = [
  "cannotCopyFile",
  "fileNotDownloadable",
  "fileNotExportable",
  "fileNotWritable",
  "exportSizeLimitExceeded",
];

/**
 * Translates a refused Drive request into a distinguishable Storage error.
 *
 * @remarks
 * `404` covers both a deleted entry and one the account cannot see, so a
 * stale reference and a missing file share `not_found`. A missing scope
 * (`insufficientPermissions`) differs from a refused file
 * (`insufficientFilePermissions`), so a consent can be offered for the first.
 */
function requestFailure(status: number, body: unknown): DriveItemFailure {
  const reasons = readErrorReasons(body);

  if (status === 401)
    return failure("connection_unavailable", "access_revoked");
  if (reasons.includes("accessNotConfigured")) {
    return failure("connection_unavailable", "drive_api_disabled");
  }
  if (status === 404) return failure("not_found");
  if (
    reasons.includes("insufficientPermissions") ||
    reasons.includes("insufficientScopes")
  ) {
    return failure("provider_scope_missing");
  }
  if (
    reasons.some((reason) => UNSUPPORTED_REASONS.includes(reason)) ||
    reasons.includes("badRequest")
  ) {
    return failure("unsupported_operation");
  }
  if (status === 413 || reasons.includes("uploadTooLarge")) {
    return failure("too_large");
  }
  if (status === 403 && !reasons.includes("rateLimitExceeded")) {
    return failure("provider_forbidden");
  }

  return status === 400
    ? failure("invalid_request")
    : failure("provider_unreachable");
}

function readSize(record: Record<string, unknown>): number | null {
  const text = readString(record, "size");
  const parsed = text === "" ? Number.NaN : Number(text);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readNullable(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const text = readString(record, key);

  return text === "" ? null : text;
}

/**
 * Converts a Drive file resource into a Storage entry.
 *
 * @param body - One file resource of the Drive API v3.
 * @returns The entry, or `null` when it carries no identifier.
 */
export function toStorageEntry(body: unknown): StorageEntry | null {
  if (!isRecord(body) || readString(body, "id") === "") {
    return null;
  }

  const mimeType = readString(body, "mimeType");
  const parents = Array.isArray(body["parents"]) ? body["parents"] : [];
  const parentId: unknown = parents[0];
  const link = readString(body, "webViewLink");

  return {
    driveRef: readNullable(body, "driveId"),
    exportFormats: GOOGLE_EXPORT_FORMATS[mimeType] ?? [],
    isFolder: mimeType === DRIVE_FOLDER_MIME_TYPE,
    isGoogleDocument: GOOGLE_EXPORT_FORMATS[mimeType] !== undefined,
    isTrashed: body["trashed"] === true,
    isExplicitlyTrashed: body["explicitlyTrashed"] === true,
    mimeType,
    modifiedAt: readNullable(body, "modifiedTime"),
    name: readString(body, "name"),
    parentRef: typeof parentId === "string" ? parentId : null,
    ref: readString(body, "id"),
    sizeBytes: readSize(body),
    version: readNullable(body, "version"),
    webViewLink: link.startsWith("https://") ? link : null,
  };
}

function toPage(body: unknown): StorageEntryPage | null {
  if (!isRecord(body) || !Array.isArray(body["files"])) {
    return null;
  }

  const files: unknown[] = body["files"];

  return {
    entries: files
      .map(toStorageEntry)
      .filter((entry): entry is StorageEntry => entry !== null),
    nextPageToken: readNullable(body, "nextPageToken"),
  };
}

function toDriveEntry(entry: unknown): StorageEntry | null {
  if (!isRecord(entry) || readString(entry, "id") === "") {
    return null;
  }

  const id = readString(entry, "id");

  return {
    driveRef: id,
    exportFormats: [],
    isExplicitlyTrashed: false,
    isFolder: true,
    isGoogleDocument: false,
    isTrashed: false,
    mimeType: DRIVE_FOLDER_MIME_TYPE,
    modifiedAt: null,
    name: readString(entry, "name"),
    parentRef: null,
    ref: id,
    sizeBytes: null,
    version: null,
    webViewLink: null,
  };
}

function toDrivePage(body: unknown): StorageEntryPage | null {
  if (!isRecord(body) || !Array.isArray(body["drives"])) {
    return null;
  }

  const drives: unknown[] = body["drives"];

  return {
    entries: drives
      .map(toDriveEntry)
      .filter((entry): entry is StorageEntry => entry !== null),
    nextPageToken: readNullable(body, "nextPageToken"),
  };
}

function toQuota(body: unknown): StorageQuotaReading | null {
  const quota = isRecord(body) ? body["storageQuota"] : null;

  if (!isRecord(quota) || readSize({ size: quota["usage"] }) === null) {
    return null;
  }

  return {
    limitBytes: readSize({ size: quota["limit"] }),
    usageBytes: readSize({ size: quota["usage"] }) ?? 0,
    usageInDriveBytes: readSize({ size: quota["usageInDrive"] }),
    usageInTrashBytes: readSize({ size: quota["usageInDriveTrash"] }),
  };
}

function multipartBody(
  upload: Omit<DriveUpload, "parentId"> & {
    readonly parents: readonly string[];
  },
): { readonly body: Uint8Array<ArrayBuffer>; readonly contentType: string } {
  const boundary = `pages-${randomBytes(12).toString("hex")}`;
  const metadata = JSON.stringify({
    mimeType: upload.mimeType,
    name: upload.name,
    ...(upload.parents.length > 0 ? { parents: upload.parents } : {}),
  });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${upload.mimeType}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

  return {
    body: Buffer.concat([head, upload.content, tail]),
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

/**
 * Reads and changes single Drive entries for the Storage interface (PAGE-270)
 * through the official Drive API v3.
 *
 * @remarks
 * Like {@link GoogleDriveFilesClient}, every request carries the access token
 * of the instance connection in the `Authorization` header only, and Google
 * decides with the rights of the connected account. Downloads and exports
 * stream; uploads are limited by the service before they reach this client.
 * Raw answers are never logged.
 */
export class GoogleDriveItemsClient {
  private readonly fetcher: GoogleFetch;

  /**
   * Creates the client.
   *
   * @param fetcher - Stand-in for `fetch`; the simulation answers here.
   */
  public constructor(fetcher: GoogleFetch = (url, init) => fetch(url, init)) {
    this.fetcher = fetcher;
  }

  /**
   * Reads the metadata of one entry.
   *
   * @param accessToken - A current access token of the connection.
   * @param fileId - Drive identifier or `root`.
   * @returns The entry, or why Drive refused it.
   */
  public async stat(
    accessToken: string,
    fileId: string,
  ): Promise<DriveItemResult<StorageEntry>> {
    const url = this.fileUrl(fileId);

    url.searchParams.set("fields", ENTRY_FIELDS);

    return this.json(accessToken, { method: "GET", url }, toStorageEntry);
  }

  /**
   * Lists one page of entries matching a Drive query.
   *
   * @param accessToken - A current access token of the connection.
   * @param request - Query, shared drive, page and page size.
   * @returns Folders first, then files, by natural name order.
   */
  public async query(
    accessToken: string,
    request: DriveQueryRequest,
  ): Promise<DriveItemResult<StorageEntryPage>> {
    const url = new URL(`${DRIVE_API}/files`);

    url.searchParams.set("q", request.query);
    url.searchParams.set("fields", `nextPageToken,files(${ENTRY_FIELDS})`);
    url.searchParams.set("orderBy", "folder,name_natural");
    url.searchParams.set("pageSize", String(request.pageSize));
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");

    if (request.driveId !== null) {
      url.searchParams.set("corpora", "drive");
      url.searchParams.set("driveId", request.driveId);
    }

    if (request.pageToken !== null) {
      url.searchParams.set("pageToken", request.pageToken);
    }

    return this.json(accessToken, { method: "GET", url }, toPage);
  }

  /**
   * Lists one page of the shared drives, each as the folder at its root.
   *
   * @param accessToken - A current access token of the connection.
   * @param request - Page cursor and size.
   * @returns The shared drives as folder entries.
   */
  public async listSharedDrives(
    accessToken: string,
    request: { readonly pageToken: string | null; readonly pageSize: number },
  ): Promise<DriveItemResult<StorageEntryPage>> {
    const url = new URL(`${DRIVE_API}/drives`);

    url.searchParams.set("pageSize", String(Math.min(request.pageSize, 100)));
    url.searchParams.set("fields", "nextPageToken,drives(id,name)");

    if (request.pageToken !== null) {
      url.searchParams.set("pageToken", request.pageToken);
    }

    return this.json(accessToken, { method: "GET", url }, toDrivePage);
  }

  /**
   * Reads the storage quota with `about.get`.
   *
   * @param accessToken - A current access token of the connection.
   * @returns The quota, or why Drive refused it.
   */
  public async readQuota(
    accessToken: string,
  ): Promise<DriveItemResult<StorageQuotaReading>> {
    const url = new URL(`${DRIVE_API}/about`);

    url.searchParams.set(
      "fields",
      "storageQuota(limit,usage,usageInDrive,usageInDriveTrash)",
    );

    return this.json(accessToken, { method: "GET", url }, toQuota);
  }

  /**
   * Streams the bytes of a file.
   *
   * @param accessToken - A current access token of the connection.
   * @param fileId - The file.
   * @returns The open stream, or why Drive refused it.
   */
  public async download(
    accessToken: string,
    fileId: string,
  ): Promise<DriveItemResult<DriveMedia>> {
    const url = this.fileUrl(fileId);

    url.searchParams.set("alt", "media");

    return this.media(accessToken, url);
  }

  /**
   * Streams the export of a Google document in one format.
   *
   * @param accessToken - A current access token of the connection.
   * @param fileId - The Google document.
   * @param mimeType - A supported export format.
   * @returns The open stream, or why Drive refused it.
   */
  public async export(
    accessToken: string,
    fileId: string,
    mimeType: string,
  ): Promise<DriveItemResult<DriveMedia>> {
    const url = new URL(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export`,
    );

    url.searchParams.set("mimeType", mimeType);

    return this.media(accessToken, url);
  }

  /**
   * Creates a folder.
   *
   * @param accessToken - A current access token of the connection.
   * @param input - Name and parent folder.
   * @returns The new folder.
   */
  public async createFolder(
    accessToken: string,
    input: { readonly name: string; readonly parentId: string },
  ): Promise<DriveItemResult<StorageEntry>> {
    const url = new URL(`${DRIVE_API}/files`);

    this.addEntryParameters(url);

    return this.json(
      accessToken,
      {
        body: JSON.stringify({
          mimeType: DRIVE_FOLDER_MIME_TYPE,
          name: input.name,
          parents: [input.parentId],
        }),
        method: "POST",
        url,
      },
      toStorageEntry,
    );
  }

  /**
   * Uploads a new file in one multipart request.
   *
   * @param accessToken - A current access token of the connection.
   * @param upload - Name, type, parent and bytes.
   * @returns The new file.
   */
  public async upload(
    accessToken: string,
    upload: DriveUpload,
  ): Promise<DriveItemResult<StorageEntry>> {
    const url = new URL(`${UPLOAD_API}/files`);
    const multipart = multipartBody({ ...upload, parents: [upload.parentId] });

    url.searchParams.set("uploadType", "multipart");
    this.addEntryParameters(url);

    return this.json(
      accessToken,
      {
        body: multipart.body,
        contentType: multipart.contentType,
        method: "POST",
        url,
      },
      toStorageEntry,
    );
  }

  /**
   * Replaces the bytes of an existing file; name and place stay.
   *
   * @param accessToken - A current access token of the connection.
   * @param fileId - The file.
   * @param content - Type and new bytes.
   * @returns The changed file.
   */
  public async replaceContent(
    accessToken: string,
    fileId: string,
    content: {
      readonly mimeType: string;
      readonly bytes: Uint8Array<ArrayBuffer>;
    },
  ): Promise<DriveItemResult<StorageEntry>> {
    const url = new URL(`${UPLOAD_API}/files/${encodeURIComponent(fileId)}`);

    url.searchParams.set("uploadType", "media");
    this.addEntryParameters(url);

    return this.json(
      accessToken,
      {
        body: content.bytes,
        contentType: content.mimeType,
        method: "PATCH",
        url,
      },
      toStorageEntry,
    );
  }

  /**
   * Changes name, trash state or parent of an entry.
   *
   * @param accessToken - A current access token of the connection.
   * @param fileId - The entry.
   * @param change - What changes.
   * @returns The changed entry.
   */
  public async change(
    accessToken: string,
    fileId: string,
    change: DriveEntryChange,
  ): Promise<DriveItemResult<StorageEntry>> {
    const url = this.fileUrl(fileId);

    this.addEntryParameters(url);

    if (change.addParentId !== undefined) {
      url.searchParams.set("addParents", change.addParentId);
    }

    if (change.removeParentId !== undefined) {
      url.searchParams.set("removeParents", change.removeParentId);
    }

    return this.json(
      accessToken,
      {
        body: JSON.stringify({
          ...(change.name === undefined ? {} : { name: change.name }),
          ...(change.isTrashed === undefined
            ? {}
            : { trashed: change.isTrashed }),
        }),
        method: "PATCH",
        url,
      },
      toStorageEntry,
    );
  }

  /**
   * Copies a file; Drive copies no folders.
   *
   * @param accessToken - A current access token of the connection.
   * @param fileId - The file.
   * @param target - Name and parent of the copy.
   * @returns The copy.
   */
  public async copy(
    accessToken: string,
    fileId: string,
    target: { readonly name: string; readonly parentId: string },
  ): Promise<DriveItemResult<StorageEntry>> {
    const url = new URL(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/copy`,
    );

    this.addEntryParameters(url);

    return this.json(
      accessToken,
      {
        body: JSON.stringify({ name: target.name, parents: [target.parentId] }),
        method: "POST",
        url,
      },
      toStorageEntry,
    );
  }

  /**
   * Deletes an entry permanently, a folder with its whole tree.
   *
   * @param accessToken - A current access token of the connection.
   * @param fileId - The entry.
   * @returns Nothing, or why Drive refused it.
   */
  public async remove(
    accessToken: string,
    fileId: string,
  ): Promise<DriveItemResult<null>> {
    const url = this.fileUrl(fileId);
    const response = await this.send(accessToken, { method: "DELETE", url });

    if (!response) {
      return failure("provider_unreachable");
    }

    return response.ok
      ? { ok: true, value: null }
      : requestFailure(response.status, await readJson(response));
  }

  private fileUrl(fileId: string): URL {
    const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`);

    url.searchParams.set("supportsAllDrives", "true");

    return url;
  }

  private addEntryParameters(url: URL): void {
    url.searchParams.set("fields", ENTRY_FIELDS);
    url.searchParams.set("supportsAllDrives", "true");
  }

  private async media(
    accessToken: string,
    url: URL,
  ): Promise<DriveItemResult<DriveMedia>> {
    const response = await this.send(accessToken, { method: "GET", url });

    if (!response) {
      return failure("provider_unreachable");
    }

    if (!response.ok) {
      return requestFailure(response.status, await readJson(response));
    }

    const length = Number(response.headers.get("Content-Length") ?? "");

    return {
      ok: true,
      value: {
        body: response.body,
        mimeType:
          response.headers.get("Content-Type") ?? "application/octet-stream",
        sizeBytes: Number.isFinite(length) && length >= 0 ? length : null,
      },
    };
  }

  private async json<Value>(
    accessToken: string,
    request: {
      readonly method: string;
      readonly url: URL;
      readonly body?: BodyInit;
      readonly contentType?: string;
    },
    read: (body: unknown) => Value | null,
  ): Promise<DriveItemResult<Value>> {
    const response = await this.send(accessToken, request);

    if (!response) {
      return failure("provider_unreachable");
    }

    const body = await readJson(response);

    if (!response.ok) {
      return requestFailure(response.status, body);
    }

    const value = read(body);

    return value === null
      ? failure("provider_unreachable")
      : { ok: true, value };
  }

  private async send(
    accessToken: string,
    request: {
      readonly method: string;
      readonly url: URL;
      readonly body?: BodyInit;
      readonly contentType?: string;
    },
  ): Promise<Response | null> {
    const isTransfer =
      request.url.searchParams.has("alt") ||
      request.url.pathname.endsWith("/export") ||
      request.url.pathname.startsWith("/upload/");
    const hasJsonBody = typeof request.body === "string";
    const contentType =
      request.contentType ??
      (hasJsonBody ? "application/json; charset=UTF-8" : null);

    return sendGoogleRequest(
      this.fetcher,
      request.url.toString(),
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...(contentType === null ? {} : { "Content-Type": contentType }),
        },
        method: request.method,
        ...(request.body === undefined ? {} : { body: request.body }),
      },
      isTransfer ? TRANSFER_TIMEOUT_MS : undefined,
    );
  }
}
