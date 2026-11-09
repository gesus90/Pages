import { GOOGLE_DRIVE_WRITE_SCOPES } from "@/backend/google/GoogleDriveConfig";
import { isDriveId } from "@/backend/google/GoogleDriveFilesClient";
import { escapeDriveLiteral } from "@/backend/google/GoogleDriveItemsClient";

import type {
  DriveItemFailure,
  GoogleDriveItemsClient,
} from "@/backend/google/GoogleDriveItemsClient";
import type { GoogleDriveConnectionService } from "@/backend/service/google/GoogleDriveConnectionService";
import type { GoogleDriveProblem } from "@/definition/GoogleDrive";
import type {
  StorageEntry,
  StorageError,
  StorageErrorCode,
  StorageResult,
  StorageScope,
} from "@/definition/GoogleDriveFiles";

/** Where an administrator grants the missing write access. */
export const STORAGE_CONSENT_PATH = "/settings/system?googleDriveAccess=write";

/** The longest name Storage accepts for a new or renamed entry. */
const MAXIMUM_NAME_LENGTH = 255;

/** A folder scope count stops after this many entries and reports `isTruncated`. */
const MAXIMUM_SCOPE_ENTRIES = 2000;

/** The problems that only a new sign-in repairs. */
const SIGN_IN_PROBLEMS: readonly GoogleDriveProblem[] = [
  "access_revoked",
  "scope_missing",
  "account_changed",
  "secret_unavailable",
];

/** The Drive calls the Storage interface makes. */
export type StorageDriveClient = Pick<
  GoogleDriveItemsClient,
  | "stat"
  | "query"
  | "listSharedDrives"
  | "readQuota"
  | "download"
  | "export"
  | "createFolder"
  | "upload"
  | "replaceContent"
  | "change"
  | "copy"
  | "remove"
>;

/** The connection the Storage interface asks for a fresh access on every call. */
export type StorageConnection = Pick<GoogleDriveConnectionService, "access">;

/** A freshly confirmed access of one call; the token never leaves the server. */
export interface StorageSession {
  readonly accessToken: string;
  readonly canWrite: boolean;
}

/**
 * Builds a failed result.
 *
 * @param code - The error code.
 * @param details - Further details of the error.
 * @returns The failure.
 */
export function storageFailure<Value>(
  code: StorageErrorCode,
  details: Omit<StorageError, "code"> = {},
): StorageResult<Value> {
  return { error: { ...details, code }, ok: false };
}

function connectionState(
  problem: GoogleDriveProblem | null,
): "reauthorization_required" | "unavailable" {
  return problem !== null && SIGN_IN_PROBLEMS.includes(problem)
    ? "reauthorization_required"
    : "unavailable";
}

/**
 * Translates a refused Drive request.
 *
 * @param failure - The refusal of the Drive client.
 * @returns The Storage failure; a missing scope carries the consent path.
 */
export function driveFailure<Value>(
  failure: DriveItemFailure,
): StorageResult<Value> {
  if (failure.connectionProblem !== null) {
    return storageFailure("connection_unavailable", {
      connectionProblem: failure.connectionProblem,
      connectionState: connectionState(failure.connectionProblem),
    });
  }

  return failure.code === "provider_scope_missing"
    ? storageFailure(failure.code, { consentPath: STORAGE_CONSENT_PATH })
    : storageFailure(failure.code);
}

/**
 * Takes a freshly confirmed access of the instance connection.
 *
 * @param connection - The Drive connection.
 * @returns The access with its write right, or why the connection is not usable.
 */
export async function openStorageSession(
  connection: StorageConnection,
): Promise<StorageResult<StorageSession>> {
  const access = await connection.access();

  if (!access.ok) {
    return storageFailure("connection_unavailable", {
      connectionProblem: access.problem,
      connectionState: access.state,
    });
  }

  return {
    ok: true,
    value: {
      accessToken: access.accessToken,
      canWrite: access.grantedScopes.some((scope) =>
        GOOGLE_DRIVE_WRITE_SCOPES.includes(scope),
      ),
    },
  };
}

/**
 * Refuses a change when the granted scopes do not allow it.
 *
 * @param session - The access of the call.
 * @returns `null` when changes are allowed, else the failure with the consent path.
 */
export function writeRefusal<Value>(
  session: StorageSession,
): StorageResult<Value> | null {
  return session.canWrite
    ? null
    : storageFailure("provider_scope_missing", {
        consentPath: STORAGE_CONSENT_PATH,
      });
}

/**
 * Checks a reference from a client.
 *
 * @param ref - Untrusted reference.
 * @returns Whether it can be a Drive identifier or the alias `root`.
 */
export function isStorageRef(ref: string): boolean {
  return ref === "root" || isDriveId(ref);
}

/**
 * Checks a name for a new or renamed entry.
 *
 * @param name - Untrusted name.
 * @returns The trimmed name, or `null` when it is empty, too long, contains a
 * slash or a control character, or is `.` or `..`.
 *
 * @remarks
 * Drive itself allows slashes, but readable paths separate their steps with
 * them, so a name with a slash could never be resolved again.
 */
export function readEntryName(name: string): string | null {
  const trimmed = name.trim();

  if (
    trimmed === "" ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.length > MAXIMUM_NAME_LENGTH ||
    trimmed.includes("/") ||
    /\p{Cc}/u.test(trimmed)
  ) {
    return null;
  }

  return trimmed;
}

/**
 * Reads an entry that must exist and must not be in the trash.
 *
 * @param drive - The Drive client.
 * @param session - The access of the call.
 * @param ref - The reference.
 * @returns The entry, or `invalid_reference`, `not_found` or `trashed`.
 */
export async function readLiveEntry(
  drive: StorageDriveClient,
  session: StorageSession,
  ref: string,
): Promise<StorageResult<StorageEntry>> {
  if (!isStorageRef(ref)) {
    return storageFailure("invalid_reference");
  }

  const entry = await drive.stat(session.accessToken, ref);

  if (!entry.ok) {
    return driveFailure(entry);
  }

  return entry.value.isTrashed
    ? storageFailure("trashed")
    : { ok: true, value: entry.value };
}

/**
 * Reads a folder that must exist and must not be in the trash.
 *
 * @param drive - The Drive client.
 * @param session - The access of the call.
 * @param ref - The reference.
 * @returns The folder, or why it cannot hold entries.
 */
export async function readLiveFolder(
  drive: StorageDriveClient,
  session: StorageSession,
  ref: string,
): Promise<StorageResult<StorageEntry>> {
  const folder = await readLiveEntry(drive, session, ref);

  if (!folder.ok) {
    return folder;
  }

  return folder.value.isFolder ? folder : storageFailure("not_folder");
}

/**
 * Lists the entries of a folder that carry a name, outside the trash.
 *
 * @param drive - The Drive client.
 * @param session - The access of the call.
 * @param input - Folder, name and an entry to leave out (the renamed one).
 * @returns The entries with exactly that name.
 */
export async function findNameConflicts(
  drive: StorageDriveClient,
  session: StorageSession,
  input: {
    readonly folder: StorageEntry;
    readonly name: string;
    readonly exceptRef?: string;
  },
): Promise<StorageResult<StorageEntry[]>> {
  const page = await drive.query(session.accessToken, {
    driveId: input.folder.driveRef,
    pageSize: 20,
    pageToken: null,
    query: `'${input.folder.ref}' in parents and name = '${escapeDriveLiteral(input.name)}' and trashed = false`,
  });

  if (!page.ok) {
    return driveFailure(page);
  }

  return {
    ok: true,
    value: page.value.entries.filter((entry) => entry.ref !== input.exceptRef),
  };
}

function splitExtension(name: string): readonly [string, string] {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/**
 * Finds a free name for `keep_both`, such as `bericht (2).pdf`.
 *
 * @param drive - The Drive client.
 * @param session - The access of the call.
 * @param input - Folder and wanted name.
 * @returns A name no entry of the folder carries.
 */
export async function findFreeName(
  drive: StorageDriveClient,
  session: StorageSession,
  input: { readonly folder: StorageEntry; readonly name: string },
): Promise<StorageResult<string>> {
  const [stem, extension] = splitExtension(input.name);
  const page = await drive.query(session.accessToken, {
    driveId: input.folder.driveRef,
    pageSize: 1000,
    pageToken: null,
    query: `'${input.folder.ref}' in parents and name contains '${escapeDriveLiteral(stem)}' and trashed = false`,
  });

  if (!page.ok) {
    return driveFailure(page);
  }

  const taken = new Set(page.value.entries.map((entry) => entry.name));

  for (let number = 2; number < 1000; number += 1) {
    const candidate = `${stem} (${number})${extension}`;

    if (!taken.has(candidate)) {
      return { ok: true, value: candidate };
    }
  }

  return storageFailure("name_conflict");
}

/** The running count of a folder scope. */
interface ScopeCount {
  fileCount: number;
  folderCount: number;
  totalBytes: number;
  readonly pending: string[];
}

function addToScope(count: ScopeCount, entries: readonly StorageEntry[]): void {
  for (const entry of entries) {
    count.folderCount += entry.isFolder ? 1 : 0;
    count.fileCount += entry.isFolder ? 0 : 1;
    count.totalBytes += entry.sizeBytes ?? 0;

    if (entry.isFolder) {
      count.pending.push(entry.ref);
    }
  }
}

/** Counts the direct children of one folder, page by page; `true` once the limit is reached. */
async function countChildren(
  drive: StorageDriveClient,
  session: StorageSession,
  input: {
    readonly driveId: string | null;
    readonly ref: string;
    readonly count: ScopeCount;
  },
): Promise<StorageResult<boolean>> {
  let pageToken: string | null = null;

  do {
    const page = await drive.query(session.accessToken, {
      driveId: input.driveId,
      pageSize: 1000,
      pageToken,
      query: `'${input.ref}' in parents`,
    });

    if (!page.ok) {
      return driveFailure(page);
    }

    addToScope(input.count, page.value.entries);

    if (
      input.count.fileCount + input.count.folderCount >=
      MAXIMUM_SCOPE_ENTRIES
    ) {
      return { ok: true, value: true };
    }

    pageToken = page.value.nextPageToken;
  } while (pageToken !== null);

  return { ok: true, value: false };
}

/**
 * Counts what a folder action reaches: every entry below the folder, the
 * trashed ones included, because a permanent deletion removes them too.
 *
 * @param drive - The Drive client.
 * @param session - The access of the call.
 * @param folder - The folder.
 * @returns Folders, files and bytes; `isTruncated` after the count limit.
 */
export async function countFolderScope(
  drive: StorageDriveClient,
  session: StorageSession,
  folder: StorageEntry,
): Promise<StorageResult<StorageScope>> {
  const count: ScopeCount = {
    fileCount: 0,
    folderCount: 0,
    pending: [folder.ref],
    totalBytes: 0,
  };
  let ref = count.pending.shift();

  while (ref !== undefined) {
    const isTruncated = await countChildren(drive, session, {
      count,
      driveId: folder.driveRef,
      ref,
    });

    if (!isTruncated.ok) {
      return { error: isTruncated.error, ok: false };
    }

    if (isTruncated.value) {
      return { ok: true, value: { ...summary(count), isTruncated: true } };
    }

    ref = count.pending.shift();
  }

  return { ok: true, value: { ...summary(count), isTruncated: false } };
}

function summary(count: ScopeCount): Omit<StorageScope, "isTruncated"> {
  return {
    fileCount: count.fileCount,
    folderCount: count.folderCount,
    totalBytes: count.totalBytes,
  };
}
