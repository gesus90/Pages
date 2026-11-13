import { z } from "zod";

import type {
  StorageBrowseResponse,
  StorageQuotaResponse,
  StorageStartFolderSaveResult,
} from "@/definition/GoogleDriveStorage";

/** The Storage endpoint; it checks the Pages right and asks Drive on every call. */
const STORAGE_ENDPOINT = "/storage-api";

const connectionSchema = z.object({
  kind: z.literal("connection"),
  state: z.enum([
    "not_configured",
    "disconnected",
    "reauthorization_required",
    "unavailable",
  ]),
  problem: z
    .enum([
      "access_revoked",
      "scope_missing",
      "client_invalid",
      "drive_api_disabled",
      "google_unreachable",
      "account_changed",
      "secret_unavailable",
    ])
    .nullable(),
});

const folderProblemSchema = z.enum([
  "not_found",
  "trashed",
  "not_folder",
  "forbidden",
  "scope_insufficient",
  "unreachable",
]);

const pathEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum([
    "my_drive",
    "shared_drives",
    "shared_drive",
    "folder",
    "detached",
  ]),
});

const startFolderSchema = z.object({
  folderId: z.string(),
  name: z.string(),
  path: z.array(pathEntrySchema),
});

const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  isFolder: z.boolean(),
  mimeType: z.string(),
  modifiedAt: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  webViewLink: z.string().nullable(),
});

const browseSchema = z.object({
  isScoped: z.boolean().optional(),
  kind: z.literal("browse"),
  accountEmail: z.string().nullable(),
  reach: z.enum(["full", "app_files"]),
  hasSharedDrives: z.boolean(),
  isSimulation: z.boolean().optional(),
  startFolder: startFolderSchema.nullable(),
  startFolderProblem: z
    .union([folderProblemSchema, z.literal("other_account")])
    .nullable(),
  startFolderRenamedFrom: z.string().nullable(),
  folderProblem: folderProblemSchema.nullable(),
  folder: z
    .object({
      folderId: z.string(),
      name: z.string(),
      path: z.array(pathEntrySchema),
      items: z.array(itemSchema),
      nextPageToken: z.string().nullable(),
      canBeStartFolder: z.boolean(),
    })
    .nullable(),
});

const quotaSchema = z.union([
  z.object({
    kind: z.literal("quota"),
    quota: z.object({
      usageBytes: z.number(),
      usageInDriveBytes: z.number().nullable(),
      limitBytes: z.number().nullable(),
      isPossiblyPooled: z.boolean(),
    }),
  }),
  z.object({ kind: z.literal("quota_unavailable") }),
  connectionSchema,
]);

const saveSchema = z.union([
  z.object({ ok: z.literal(true), startFolder: startFolderSchema.nullable() }),
  z.object({
    ok: z.literal(false),
    error: z.union([
      folderProblemSchema,
      z.literal("connection"),
      z.literal("invalid"),
    ]),
  }),
]);

/** Why the endpoint gave no usable answer. */
export type StorageRequestFailure = "forbidden" | "failed";

/** An answer of the endpoint, or why there is none. */
export type StorageReply<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly failure: StorageRequestFailure };

/** What one folder request asks for. */
export interface StorageFolderQuery {
  readonly folderId: string | null;
  readonly pageToken: string | null;
  readonly isFoldersOnly: boolean;
}

async function readReply<Value>(
  request: Promise<Response>,
  schema: z.ZodType<Value>,
): Promise<StorageReply<Value>> {
  try {
    const response = await request;

    if (response.status === 403) {
      return { failure: "forbidden", ok: false };
    }

    const parsed = schema.safeParse(await response.json());

    return parsed.success
      ? { ok: true, value: parsed.data }
      : { failure: "failed", ok: false };
  } catch {
    // An aborted or failed request shows the error state, never stale content.
    return { failure: "failed", ok: false };
  }
}

/**
 * Reads one folder of the connected Google Drive.
 *
 * @param query - Target, page and whether only folders count.
 * @param signal - Ends the request when the view moves on.
 * @returns The folder, or why it is not shown.
 */
export async function requestStorageFolder(
  query: StorageFolderQuery,
  signal: AbortSignal,
): Promise<StorageReply<StorageBrowseResponse>> {
  const parameters = new URLSearchParams();

  if (query.folderId !== null) parameters.set("folder", query.folderId);
  if (query.pageToken !== null) parameters.set("pageToken", query.pageToken);
  if (query.isFoldersOnly) parameters.set("foldersOnly", "1");

  return readReply(
    fetch(`${STORAGE_ENDPOINT}?${parameters.toString()}`, {
      headers: { Accept: "application/json" },
      signal,
    }),
    browseSchema.or(connectionSchema),
  );
}

/**
 * Reads the storage quota of the connected Google account.
 *
 * @param signal - Ends the request when the view leaves.
 * @returns The quota, or why it is not shown.
 */
export async function requestStorageQuota(
  signal: AbortSignal,
): Promise<StorageReply<StorageQuotaResponse>> {
  return readReply(
    fetch(`${STORAGE_ENDPOINT}?view=quota`, {
      headers: { Accept: "application/json" },
      signal,
    }),
    quotaSchema,
  );
}

/**
 * Saves a folder as start folder, or clears it with `null`.
 *
 * @param folderId - The Drive identifier of the folder, or `null` to clear.
 * @returns The saved start folder, or why it was not saved.
 */
export async function requestStartFolderChange(
  folderId: string | null,
): Promise<StorageReply<StorageStartFolderSaveResult>> {
  const body =
    folderId === null
      ? new URLSearchParams({ intent: "clear-start" })
      : new URLSearchParams({ folderId, intent: "save-start" });

  return readReply(
    fetch(STORAGE_ENDPOINT, { body, method: "POST" }),
    saveSchema,
  );
}
