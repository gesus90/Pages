import { GOOGLE_DRIVE_TREE_SCOPES } from "@/backend/google/GoogleDriveConfig";
import { isDriveId } from "@/backend/google/GoogleDriveFilesClient";
import { StoragePathResolver } from "@/backend/service/google/StoragePathResolver";
import {
  STORAGE_MY_DRIVE_ID,
  STORAGE_SHARED_DRIVES_ID,
} from "@/definition/GoogleDriveStorage";

import type {
  DriveRequestFailure,
  DriveRequestResult,
  GoogleDriveFilesClient,
} from "@/backend/google/GoogleDriveFilesClient";
import type {
  StorageStartFolderRepository,
  StoredStorageStartFolder,
} from "@/backend/database/repositories/google/StorageStartFolderRepository";
import type {
  GoogleDriveAccess,
  GoogleDriveConnectionService,
} from "@/backend/service/google/GoogleDriveConnectionService";
import type { GoogleDriveProblem } from "@/definition/GoogleDrive";
import type {
  StorageAccessReach,
  StorageBrowseResponse,
  StorageBrowseResult,
  StorageConnectionUnavailable,
  StorageFolderView,
  StoragePathEntry,
  StorageQuotaResponse,
  StorageStartFolder,
  StorageStartFolderSaveResult,
} from "@/definition/GoogleDriveStorage";

/** Consumer Google accounts; any other address may belong to a Workspace storage pool. */
const CONSUMER_DOMAINS = ["gmail.com", "googlemail.com"];

/** The problems that only a new sign-in repairs. */
const SIGN_IN_PROBLEMS: readonly GoogleDriveProblem[] = [
  "access_revoked",
  "scope_missing",
  "account_changed",
  "secret_unavailable",
];

/** A usable connection of one request. */
type UsableAccess = Extract<GoogleDriveAccess, { ok: true }>;

/** What one folder request asks for. */
export interface StorageBrowseRequest {
  readonly userId: string;
  /** An explicit target; `null` opens the saved start folder or My Drive. */
  readonly folderId: string | null;
  readonly pageToken: string | null;
  readonly isFoldersOnly: boolean;
}

/** Collaborators of the storage service. */
export interface GoogleDriveStorageDependencies {
  readonly connection: Pick<GoogleDriveConnectionService, "access">;
  readonly files: Pick<
    GoogleDriveFilesClient,
    | "readFolder"
    | "readSharedDriveName"
    | "listFolder"
    | "listSharedDrives"
    | "readQuota"
  >;
  readonly startFolders: Pick<
    StorageStartFolderRepository,
    "find" | "save" | "rename" | "remove"
  >;
  readonly now?: () => number;
  /** Whether Drive is the in-memory simulation (PAGE-270); answers say so. */
  readonly isSimulation?: boolean;
}

/** A folder Drive confirmed, with its path. */
interface ResolvedFolder {
  readonly id: string;
  readonly name: string;
  readonly driveId: string | null;
  readonly path: readonly StoragePathEntry[];
}

function unavailable(
  access: Extract<GoogleDriveAccess, { ok: false }>,
): StorageConnectionUnavailable {
  return { kind: "connection", problem: access.problem, state: access.state };
}

function refusedConnection(
  problem: GoogleDriveProblem,
): StorageConnectionUnavailable {
  return {
    kind: "connection",
    problem,
    state: SIGN_IN_PROBLEMS.includes(problem)
      ? "reauthorization_required"
      : "unavailable",
  };
}

function reachOf(grantedScopes: readonly string[]): StorageAccessReach {
  return grantedScopes.some((scope) => GOOGLE_DRIVE_TREE_SCOPES.includes(scope))
    ? "full"
    : "app_files";
}

function isPossiblyPooled(emailAddress: string | null): boolean {
  const domain = emailAddress?.split("@").pop()?.toLowerCase() ?? "";

  return !CONSUMER_DOMAINS.includes(domain);
}

function pathText(path: readonly StoragePathEntry[]): string {
  return JSON.stringify(path);
}

function readStoredPath(text: string): StoragePathEntry[] {
  try {
    const parsed: unknown = JSON.parse(text);

    return Array.isArray(parsed) ? parsed.filter(isPathEntry) : [];
  } catch {
    // A damaged copy only loses the readable path; the identifier still finds the folder.
    return [];
  }
}

function isPathEntry(value: unknown): value is StoragePathEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "role" in value &&
    typeof value.role === "string"
  );
}

function toStartFolder(stored: StoredStorageStartFolder): StorageStartFolder {
  return {
    folderId: stored.folderId,
    name: stored.folderName,
    path: readStoredPath(stored.folderPath),
  };
}

function displayName(folder: ResolvedFolder): string {
  const last = folder.path.at(-1);

  return last && last.role !== "folder" && last.name === ""
    ? folder.name
    : (last?.name ?? folder.name);
}

/**
 * The Storage area (PAGE-188): browses the Google Drive of the instance
 * connection read-only and keeps the start folder of each account.
 *
 * @remarks
 * Every request takes a freshly confirmed access of the existing connection,
 * so Google decides with the rights of the bound account and the granted
 * scopes; nothing is cached or shared beyond that. The start folder is a
 * navigation preference only: it grants nothing, limits nothing and is never
 * replaced silently by another folder.
 */
export class GoogleDriveStorageService {
  private readonly connection: GoogleDriveStorageDependencies["connection"];
  private readonly files: GoogleDriveStorageDependencies["files"];
  private readonly startFolders: GoogleDriveStorageDependencies["startFolders"];
  private readonly now: () => number;
  private readonly isSimulation: boolean;

  /**
   * Creates the storage service.
   *
   * @param dependencies - The connection, the Drive client, the start folders and the clock.
   */
  public constructor(dependencies: GoogleDriveStorageDependencies) {
    this.connection = dependencies.connection;
    this.files = dependencies.files;
    this.startFolders = dependencies.startFolders;
    this.now = dependencies.now ?? Date.now;
    this.isSimulation = dependencies.isSimulation ?? false;
  }

  /**
   * Shows one folder: an explicit target exactly, otherwise the saved start
   * folder or, without one, My Drive.
   *
   * @param request - Account, target, page and whether only folders count.
   * @returns The folder with path and content, or why it is not shown.
   */
  public async browse(
    request: StorageBrowseRequest,
  ): Promise<StorageBrowseResponse> {
    const access = await this.connection.access();

    if (!access.ok) {
      return unavailable(access);
    }

    const saved = await this.startFolders.find(request.userId);
    const isOwnStart = saved?.googlePermissionId === access.permissionId;
    const reach = reachOf(access.grantedScopes);
    const base: StorageBrowseResult = {
      accountEmail: access.accountEmail,
      folder: null,
      folderProblem: null,
      hasSharedDrives: reach === "full",
      isSimulation: this.isSimulation,
      kind: "browse",
      reach,
      startFolder: saved && isOwnStart ? toStartFolder(saved) : null,
      startFolderProblem: null,
      startFolderRenamedFrom: null,
    };

    if (request.folderId !== null || !saved) {
      return this.showTarget(access, base, {
        ...request,
        folderId: request.folderId ?? STORAGE_MY_DRIVE_ID,
      });
    }

    if (!isOwnStart) {
      return { ...base, startFolderProblem: "other_account" };
    }

    return this.showStartFolder(access, base, { request, saved });
  }

  /**
   * Reads the storage quota of the connected Google account.
   *
   * @returns Use and limit as Drive `about.get` names them, or why not.
   */
  public async readQuota(): Promise<StorageQuotaResponse> {
    const access = await this.connection.access();

    if (!access.ok) {
      return unavailable(access);
    }

    const quota = await this.files.readQuota(access.accessToken);

    if (!quota.ok) {
      return quota.connectionProblem
        ? refusedConnection(quota.connectionProblem)
        : { kind: "quota_unavailable" };
    }

    return {
      kind: "quota",
      quota: {
        isPossiblyPooled: isPossiblyPooled(
          quota.value.emailAddress ?? access.accountEmail,
        ),
        limitBytes: quota.value.limitBytes,
        usageBytes: quota.value.usageBytes,
        usageInDriveBytes: quota.value.usageInDriveBytes,
      },
    };
  }

  /**
   * Saves a folder as start folder of an account after Drive confirmed it.
   *
   * @param userId - The account.
   * @param folderId - The Drive identifier the person chose.
   * @returns The saved start folder, or why it was not saved.
   *
   * @remarks
   * Name and path come from Drive, never from the browser, and the folder is
   * stored by its identifier together with the bound Google account.
   */
  public async saveStartFolder(
    userId: string,
    folderId: string,
  ): Promise<StorageStartFolderSaveResult> {
    if (!isDriveId(folderId) || folderId === STORAGE_SHARED_DRIVES_ID) {
      return { error: "invalid", ok: false };
    }

    const access = await this.connection.access();

    if (!access.ok) {
      return { error: "connection", ok: false };
    }

    const folder = await this.resolveFolder(access, folderId);

    if (!folder.ok) {
      return {
        error: folder.connectionProblem ? "connection" : folder.folderProblem,
        ok: false,
      };
    }

    const resolved = folder.value;

    await this.startFolders.save(
      {
        driveId: resolved.driveId,
        folderId: resolved.id,
        folderName: displayName(resolved),
        folderPath: pathText(resolved.path),
        googlePermissionId: access.permissionId,
        userId,
      },
      this.now(),
    );

    return {
      ok: true,
      startFolder: {
        folderId: resolved.id,
        name: displayName(resolved),
        path: resolved.path,
      },
    };
  }

  /**
   * Removes the start folder of an account; Storage then opens My Drive.
   *
   * @param userId - The account.
   * @returns The empty start folder.
   */
  public async clearStartFolder(
    userId: string,
  ): Promise<StorageStartFolderSaveResult> {
    await this.startFolders.remove(userId);

    return { ok: true, startFolder: null };
  }

  private async showTarget(
    access: UsableAccess,
    base: StorageBrowseResult,
    request: StorageBrowseRequest & { readonly folderId: string },
  ): Promise<StorageBrowseResponse> {
    if (!isDriveId(request.folderId)) {
      return { ...base, folderProblem: "not_found" };
    }

    const view = await this.readView(access, base.reach, request);

    if (!view.ok) {
      return view.connectionProblem
        ? refusedConnection(view.connectionProblem)
        : { ...base, folderProblem: view.folderProblem };
    }

    return { ...base, folder: view.value };
  }

  /**
   * Opens the saved start folder by its identifier.
   *
   * @remarks
   * A folder Drive no longer shows, has in the trash or refuses is reported
   * for a new choice instead of opening another folder. A rename keeps the
   * folder; its new name and path replace the stored copy and are reported.
   */
  private async showStartFolder(
    access: UsableAccess,
    base: StorageBrowseResult,
    input: {
      readonly request: StorageBrowseRequest;
      readonly saved: StoredStorageStartFolder;
    },
  ): Promise<StorageBrowseResponse> {
    const { request, saved } = input;
    const view = await this.readView(access, base.reach, {
      ...request,
      folderId: saved.folderId,
    });

    if (!view.ok) {
      return view.connectionProblem
        ? refusedConnection(view.connectionProblem)
        : { ...base, startFolderProblem: view.folderProblem };
    }

    const folder = view.value;
    const currentPath = pathText(folder.path);

    if (folder.name === saved.folderName && currentPath === saved.folderPath) {
      return { ...base, folder };
    }

    await this.startFolders.rename({
      folderId: saved.folderId,
      folderName: folder.name,
      folderPath: currentPath,
      userId: saved.userId,
    });

    return {
      ...base,
      folder,
      startFolder: {
        folderId: saved.folderId,
        name: folder.name,
        path: folder.path,
      },
      startFolderRenamedFrom:
        folder.name === saved.folderName ? null : saved.folderName,
    };
  }

  private async readView(
    access: UsableAccess,
    reach: StorageAccessReach,
    request: StorageBrowseRequest & { readonly folderId: string },
  ): Promise<DriveRequestResult<StorageFolderView>> {
    if (request.folderId === STORAGE_SHARED_DRIVES_ID) {
      return this.readSharedDrives(access, reach, request.pageToken);
    }

    const folder = await this.resolveFolder(access, request.folderId);

    if (!folder.ok) {
      return folder;
    }

    const resolved = folder.value;
    const page = await this.files.listFolder(access.accessToken, {
      driveId: resolved.driveId,
      folderId: resolved.id,
      isFoldersOnly: request.isFoldersOnly,
      pageToken: request.pageToken,
    });

    if (!page.ok) {
      return page;
    }

    return {
      ok: true,
      value: {
        canBeStartFolder: true,
        folderId: resolved.id,
        items: page.value.items,
        name: displayName(resolved),
        nextPageToken: page.value.nextPageToken,
        path: resolved.path,
      },
    };
  }

  private async readSharedDrives(
    access: UsableAccess,
    reach: StorageAccessReach,
    pageToken: string | null,
  ): Promise<DriveRequestResult<StorageFolderView>> {
    if (reach !== "full") {
      return {
        connectionProblem: null,
        folderProblem: "scope_insufficient",
        ok: false,
      } satisfies DriveRequestFailure;
    }

    const page = await this.files.listSharedDrives(
      access.accessToken,
      pageToken,
    );

    if (!page.ok) {
      return page;
    }

    return {
      ok: true,
      value: {
        canBeStartFolder: false,
        folderId: STORAGE_SHARED_DRIVES_ID,
        items: page.value.items,
        name: "",
        nextPageToken: page.value.nextPageToken,
        path: [
          { id: STORAGE_SHARED_DRIVES_ID, name: "", role: "shared_drives" },
        ],
      },
    };
  }

  private async resolveFolder(
    access: UsableAccess,
    folderId: string,
  ): Promise<DriveRequestResult<ResolvedFolder>> {
    const metadata = await this.files.readFolder(access.accessToken, folderId);

    if (!metadata.ok) {
      return metadata;
    }

    const folder = metadata.value;

    if (folder.isTrashed || !folder.isFolder) {
      return {
        connectionProblem: null,
        folderProblem: folder.isTrashed ? "trashed" : "not_folder",
        ok: false,
      };
    }

    const path = await new StoragePathResolver(
      this.files,
      access.accessToken,
    ).resolve(folder);

    return {
      ok: true,
      value: {
        driveId: folder.driveId,
        id: folder.id,
        name: folder.name,
        path,
      },
    };
  }
}
