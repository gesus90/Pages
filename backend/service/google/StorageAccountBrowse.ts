import type { StorageAccessContext } from "./StorageAccessService";
import type { StorageAccountFiles } from "./StorageAccountFiles";
import type {
  StorageBrowseResult,
  StorageItem,
} from "@/definition/GoogleDriveStorage";
import type { StorageResult } from "@/definition/GoogleDriveFiles";

/** Builds the ordinary Storage view from the same account-scoped file API. */
export async function browseAccountStorage(
  files: StorageAccountFiles,
  context: StorageAccessContext,
  input: {
    readonly folderId: string | null;
    readonly pageToken: string | null;
    readonly isFoldersOnly: boolean;
  },
): Promise<StorageResult<StorageBrowseResult>> {
  const folderId = input.folderId ?? "root";
  const base = {
    kind: "browse",
    isScoped: true,
    accountEmail: null,
    reach: "full",
    hasSharedDrives: false,
    isSimulation: files.isSimulation,
    startFolder: null,
    startFolderProblem: null,
    startFolderRenamedFrom: null,
    folderProblem: null,
  } as const;
  if (folderId === "root") {
    const roots = [
      ...new Map(
        context.grants.map((grant) => [grant.folderRef, grant]),
      ).values(),
    ];
    return {
      ok: true,
      value: {
        ...base,
        folder: {
          folderId,
          name: "Storage",
          path: [],
          canBeStartFolder: false,
          nextPageToken: null,
          items: roots.map((grant) => ({
            id: grant.folderRef,
            name: grant.folderName,
            isFolder: true,
            mimeType: "application/vnd.google-apps.folder",
            modifiedAt: null,
            sizeBytes: null,
            webViewLink: null,
          })),
        },
      },
    };
  }
  const listing = await files.reader.list({
    ref: folderId,
    isTrash: false,
    pageSize: null,
    pageToken: input.pageToken,
  });
  if (!listing.ok) return listing;
  const folder = listing.value.folder;
  if (!folder) return { ok: false, error: { code: "not_folder" } };
  const items: StorageItem[] = listing.value.entries
    .filter((entry) => !input.isFoldersOnly || entry.isFolder)
    .map((entry) => ({
      id: entry.ref,
      name: entry.name,
      isFolder: entry.isFolder,
      mimeType: entry.mimeType,
      modifiedAt: entry.modifiedAt,
      sizeBytes: entry.sizeBytes,
      webViewLink: entry.webViewLink,
    }));
  return {
    ok: true,
    value: {
      ...base,
      folder: {
        folderId,
        name: folder.name,
        canBeStartFolder: false,
        path: [{ id: folder.ref, name: folder.name, role: "folder" }],
        items,
        nextPageToken: listing.value.nextPageToken,
      },
    },
  };
}
