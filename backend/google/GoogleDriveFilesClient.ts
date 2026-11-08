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
  StorageFolderProblem,
  StorageItem,
} from "@/definition/GoogleDriveStorage";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const FOLDER_FIELDS = "id,name,mimeType,parents,trashed,driveId";
const ITEM_FIELDS = "id,name,mimeType,modifiedTime,size,webViewLink";
const PAGE_SIZE = "200";

/** Drive identifiers are URL-safe; anything else never reaches a query. */
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

/** A refused Drive request: what the folder view says, and a connection problem when there is one. */
export interface DriveRequestFailure {
  readonly ok: false;
  readonly folderProblem: StorageFolderProblem;
  /** Set when the stored access itself is refused or the Drive API is off. */
  readonly connectionProblem: GoogleDriveProblem | null;
}

/** The outcome of one Drive request. */
export type DriveRequestResult<Value> =
  { readonly ok: true; readonly value: Value } | DriveRequestFailure;

/** The metadata of one folder as Drive names it. */
export interface DriveFolderMetadata {
  readonly id: string;
  readonly name: string;
  readonly isFolder: boolean;
  readonly isTrashed: boolean;
  readonly parentId: string | null;
  /** The shared drive of the folder, `null` in My Drive. */
  readonly driveId: string | null;
}

/** One page of a listing. */
export interface DriveItemPage {
  readonly items: readonly StorageItem[];
  readonly nextPageToken: string | null;
}

/** The raw storage quota fields of `about.get`, already as numbers. */
export interface DriveQuotaReading {
  readonly usageBytes: number;
  readonly usageInDriveBytes: number | null;
  /** `null` when Drive names no limit, which means unlimited storage. */
  readonly limitBytes: number | null;
  readonly emailAddress: string | null;
}

/** What one listing asks for. */
export interface DriveListRequest {
  readonly folderId: string;
  /** The shared drive of the folder; the listing then stays inside it. */
  readonly driveId: string | null;
  readonly pageToken: string | null;
  readonly isFoldersOnly: boolean;
}

/**
 * Tells whether a value can be a Drive identifier.
 *
 * @param value - Untrusted input.
 * @returns Whether it consists of the URL-safe characters of Drive identifiers.
 */
export function isDriveId(value: string): boolean {
  return DRIVE_ID_PATTERN.test(value);
}

function failure(
  folderProblem: StorageFolderProblem,
  connectionProblem: GoogleDriveProblem | null = null,
): DriveRequestFailure {
  return { connectionProblem, folderProblem, ok: false };
}

/**
 * Translates a refused Drive request.
 *
 * @remarks
 * Drive answers `404` both for a deleted file and for one the account cannot
 * see. A `403` with `insufficientFilePermissions` means the account may not
 * open it; `insufficientPermissions` means the granted scope does not reach it.
 */
function requestFailure(status: number, body: unknown): DriveRequestFailure {
  const reasons = readErrorReasons(body);

  if (status === 401) {
    return failure("unreachable", "access_revoked");
  }

  if (reasons.includes("accessNotConfigured")) {
    return failure("unreachable", "drive_api_disabled");
  }

  if (status === 404) {
    return failure("not_found");
  }

  if (
    reasons.includes("insufficientPermissions") ||
    reasons.includes("insufficientScopes")
  ) {
    return failure("scope_insufficient");
  }

  return status === 403 ? failure("forbidden") : failure("unreachable");
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const text = readString(record, key);
  const parsed = text === "" ? Number.NaN : Number(text);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readLink(record: Record<string, unknown>): string | null {
  const link = readString(record, "webViewLink");

  return link.startsWith("https://") ? link : null;
}

function toItem(entry: unknown): StorageItem | null {
  if (!isRecord(entry) || readString(entry, "id") === "") {
    return null;
  }

  const mimeType = readString(entry, "mimeType");
  const modifiedAt = readString(entry, "modifiedTime");

  return {
    id: readString(entry, "id"),
    isFolder: mimeType === FOLDER_MIME_TYPE,
    mimeType,
    modifiedAt: modifiedAt === "" ? null : modifiedAt,
    name: readString(entry, "name"),
    sizeBytes: readNumber(entry, "size"),
    webViewLink: readLink(entry),
  };
}

function toSharedDrive(entry: unknown): StorageItem | null {
  if (!isRecord(entry) || readString(entry, "id") === "") {
    return null;
  }

  return {
    id: readString(entry, "id"),
    isFolder: true,
    mimeType: FOLDER_MIME_TYPE,
    modifiedAt: null,
    name: readString(entry, "name"),
    sizeBytes: null,
    webViewLink: null,
  };
}

function toFolder(body: unknown): DriveFolderMetadata | null {
  if (!isRecord(body) || readString(body, "id") === "") {
    return null;
  }

  const parents = Array.isArray(body["parents"]) ? body["parents"] : [];
  const parentId: unknown = parents[0];
  const driveId = readString(body, "driveId");

  return {
    driveId: driveId === "" ? null : driveId,
    id: readString(body, "id"),
    isFolder: readString(body, "mimeType") === FOLDER_MIME_TYPE,
    isTrashed: body["trashed"] === true,
    name: readString(body, "name"),
    parentId: typeof parentId === "string" ? parentId : null,
  };
}

function toPage(
  body: unknown,
  listKey: string,
  toEntry: (entry: unknown) => StorageItem | null,
): DriveItemPage | null {
  if (!isRecord(body) || !Array.isArray(body[listKey])) {
    return null;
  }

  const entries: unknown[] = body[listKey];
  const nextPageToken = readString(body, "nextPageToken");

  return {
    items: entries
      .map(toEntry)
      .filter((item): item is StorageItem => item !== null),
    nextPageToken: nextPageToken === "" ? null : nextPageToken,
  };
}

function toQuota(body: unknown): DriveQuotaReading | null {
  if (!isRecord(body) || !isRecord(body["storageQuota"])) {
    return null;
  }

  const quota = body["storageQuota"];
  const usageBytes = readNumber(quota, "usage");
  const user = isRecord(body["user"]) ? body["user"] : {};
  const emailAddress = readString(user, "emailAddress");

  if (usageBytes === null) {
    return null;
  }

  return {
    emailAddress: emailAddress === "" ? null : emailAddress,
    limitBytes: readNumber(quota, "limit"),
    usageBytes,
    usageInDriveBytes: readNumber(quota, "usageInDrive"),
  };
}

function listUrl(request: DriveListRequest): string {
  const url = new URL(`${DRIVE_API}/files`);
  const folderClause = request.isFoldersOnly
    ? ` and mimeType = '${FOLDER_MIME_TYPE}'`
    : "";

  // The identifier is checked against DRIVE_ID_PATTERN, so it cannot end the quoted literal.
  url.searchParams.set(
    "q",
    `'${request.folderId}' in parents and trashed = false${folderClause}`,
  );
  url.searchParams.set("fields", `nextPageToken,files(${ITEM_FIELDS})`);
  url.searchParams.set("orderBy", "folder,name_natural");
  url.searchParams.set("pageSize", PAGE_SIZE);
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  if (request.driveId !== null) {
    url.searchParams.set("corpora", "drive");
    url.searchParams.set("driveId", request.driveId);
  }

  if (request.pageToken !== null) {
    url.searchParams.set("pageToken", request.pageToken);
  }

  return url.toString();
}

/**
 * Reads folders, files and the storage quota of the connected Google account
 * through the official Drive API v3, read-only.
 *
 * @remarks
 * Every request carries the access token of the instance connection in the
 * `Authorization` header only, never in an address. Google decides with the
 * rights of the connected account and the granted scopes what it returns;
 * this client neither widens nor caches that. Raw answers are never logged.
 */
export class GoogleDriveFilesClient {
  private readonly fetcher: GoogleFetch;

  /**
   * Creates the client.
   *
   * @param fetcher - Stand-in for `fetch`.
   */
  public constructor(fetcher: GoogleFetch = (url, init) => fetch(url, init)) {
    this.fetcher = fetcher;
  }

  /**
   * Reads the metadata of one folder or file.
   *
   * @param accessToken - A current access token of the connection.
   * @param fileId - Drive identifier, or `root` for the My Drive root.
   * @returns The metadata, or why Drive refused it.
   */
  public async readFolder(
    accessToken: string,
    fileId: string,
  ): Promise<DriveRequestResult<DriveFolderMetadata>> {
    const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`);

    url.searchParams.set("fields", FOLDER_FIELDS);
    url.searchParams.set("supportsAllDrives", "true");

    return this.get(accessToken, url.toString(), toFolder);
  }

  /**
   * Lists one page of the content of a folder that is not in the trash.
   *
   * @param accessToken - A current access token of the connection.
   * @param request - Folder, its shared drive, the page and whether only folders count.
   * @returns Folders first, then files, by natural name order.
   */
  public async listFolder(
    accessToken: string,
    request: DriveListRequest,
  ): Promise<DriveRequestResult<DriveItemPage>> {
    return this.get(accessToken, listUrl(request), (body) =>
      toPage(body, "files", toItem),
    );
  }

  /**
   * Lists one page of the shared drives the account is a member of.
   *
   * @param accessToken - A current access token of the connection.
   * @param pageToken - The cursor of a previous page, or `null`.
   * @returns The shared drives as folders.
   */
  public async listSharedDrives(
    accessToken: string,
    pageToken: string | null,
  ): Promise<DriveRequestResult<DriveItemPage>> {
    const url = new URL(`${DRIVE_API}/drives`);

    url.searchParams.set("pageSize", "100");
    url.searchParams.set("fields", "nextPageToken,drives(id,name)");

    if (pageToken !== null) {
      url.searchParams.set("pageToken", pageToken);
    }

    return this.get(accessToken, url.toString(), (body) =>
      toPage(body, "drives", toSharedDrive),
    );
  }

  /**
   * Reads the name of a shared drive.
   *
   * @param accessToken - A current access token of the connection.
   * @param driveId - The shared drive.
   * @returns Its name, or why Drive refused it.
   */
  public async readSharedDriveName(
    accessToken: string,
    driveId: string,
  ): Promise<DriveRequestResult<string>> {
    const url = new URL(`${DRIVE_API}/drives/${encodeURIComponent(driveId)}`);

    url.searchParams.set("fields", "id,name");

    return this.get(accessToken, url.toString(), (body) =>
      isRecord(body) ? readString(body, "name") : null,
    );
  }

  /**
   * Reads the storage quota of the account with `about.get`.
   *
   * @param accessToken - A current access token of the connection.
   * @returns `storageQuota` as numbers, or why Drive refused it.
   */
  public async readQuota(
    accessToken: string,
  ): Promise<DriveRequestResult<DriveQuotaReading>> {
    const url = new URL(`${DRIVE_API}/about`);

    url.searchParams.set(
      "fields",
      "storageQuota(limit,usage,usageInDrive),user(emailAddress)",
    );

    return this.get(accessToken, url.toString(), toQuota);
  }

  private async get<Value>(
    accessToken: string,
    url: string,
    read: (body: unknown) => Value | null,
  ): Promise<DriveRequestResult<Value>> {
    const response = await sendGoogleRequest(this.fetcher, url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    });

    if (!response) {
      return failure("unreachable");
    }

    const body = await readJson(response);

    if (!response.ok) {
      return requestFailure(response.status, body);
    }

    const value = read(body);

    return value === null ? failure("unreachable") : { ok: true, value };
  }
}
