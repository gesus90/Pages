import { z } from "zod";

import { STORAGE_OPERATIONS } from "@/definition/GoogleDriveFiles";

import type {
  StorageBatchAction,
  StorageBatchResult,
  StorageCapabilities,
  StorageEntry,
  StorageError,
  StorageErrorCode,
  StorageOperation,
} from "@/definition/GoogleDriveFiles";

/** The Storage interface of PAGE-270; one path per operation. */
const STORAGE_API_V1 = "/storage-api/v1";

const ERROR_CODES = [
  "forbidden",
  "invalid_request",
  "invalid_reference",
  "invalid_path",
  "not_found",
  "trashed",
  "not_trashed",
  "not_folder",
  "is_folder",
  "ambiguous_path",
  "name_conflict",
  "confirmation_required",
  "confirmation_invalid",
  "unsupported_operation",
  "too_large",
  "provider_forbidden",
  "provider_scope_missing",
  "connection_unavailable",
  "provider_unreachable",
  "failed",
] as const satisfies readonly StorageErrorCode[];

const entrySchema = z.object({
  ref: z.string(),
  name: z.string(),
  isFolder: z.boolean(),
  mimeType: z.string(),
  isGoogleDocument: z.boolean(),
  isTrashed: z.boolean(),
  isExplicitlyTrashed: z.boolean(),
  modifiedAt: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  parentRef: z.string().nullable(),
  driveRef: z.string().nullable(),
  version: z.string().nullable(),
  webViewLink: z.string().nullable(),
  exportFormats: z.array(z.string()),
});

const scopeSchema = z.object({
  folderCount: z.number(),
  fileCount: z.number(),
  totalBytes: z.number(),
  isTruncated: z.boolean(),
});

const confirmationSchema = z.object({
  token: z.string(),
  action: z.enum(["delete", "delete_permanently", "update", "overwrite"]),
  target: entrySchema,
  scope: scopeSchema.nullable(),
  expiresAt: z.string(),
});

// The view needs only these details; the connection details stay unread.
const errorSchema = z.object({
  code: z.enum(ERROR_CODES),
  conflicts: z.array(entrySchema).optional(),
  confirmation: confirmationSchema.optional(),
  consentPath: z.string().optional(),
  limitBytes: z.number().optional(),
});

const capabilitiesSchema = z.object({
  canRead: z.boolean(),
  canWrite: z.boolean(),
  canRequestWriteAccess: z.boolean(),
  maxUploadBytes: z.number(),
  maxReadBytes: z.number(),
  pageSizeLimit: z.number(),
  operations: z.array(z.enum(STORAGE_OPERATIONS)),
  exportFormats: z.record(z.string(), z.array(z.string())),
  isSimulation: z.boolean(),
});

const listingSchema = z.object({
  folder: entrySchema.nullable(),
  entries: z.array(entrySchema),
  nextPageToken: z.string().nullable(),
});

const batchResultSchema = z.object({
  action: z.enum(["copy", "move", "delete"]),
  succeeded: z.number(),
  failures: z.array(z.object({ ref: z.string(), code: z.enum(ERROR_CODES) })),
});

const failureEnvelopeSchema = z.object({
  ok: z.literal(false),
  simulation: z.boolean(),
  error: errorSchema,
});

/** One page of a listing of the Storage interface. */
export interface StorageListingPage {
  readonly folder: StorageEntry | null;
  readonly entries: readonly StorageEntry[];
  readonly nextPageToken: string | null;
}

/** The answer of one call of the Storage interface, or why there is none. */
export type StorageApiReply<Value> =
  | { readonly ok: true; readonly simulation: boolean; readonly value: Value }
  | { readonly ok: false; readonly error: StorageError };

/**
 * One changing call: the operation and its fields; an upload also carries
 * its file and goes as a multipart form, every other call as JSON.
 */
export interface StorageChange {
  readonly operation: StorageOperation;
  readonly fields: Readonly<Record<string, string>>;
  readonly file?: File;
}

const FAILED: StorageApiReply<never> = { error: { code: "failed" }, ok: false };

async function readApiReply<Value>(
  request: Promise<Response>,
  schema: z.ZodType<Value>,
): Promise<StorageApiReply<Value>> {
  try {
    const body: unknown = await (await request).json();
    const success = z
      .object({ ok: z.literal(true), simulation: z.boolean(), result: schema })
      .safeParse(body);

    if (success.success) {
      return {
        ok: true,
        simulation: success.data.simulation,
        value: success.data.result,
      };
    }

    const failure = failureEnvelopeSchema.safeParse(body);

    return failure.success ? { error: failure.data.error, ok: false } : FAILED;
  } catch {
    // An aborted or failed request is reported as `failed`, never as success.
    return FAILED;
  }
}

/**
 * Reads what the connected account may do in Storage right now.
 *
 * @param signal - Ends the request when the view leaves.
 * @returns The capabilities, or why they are unknown.
 */
export async function requestStorageCapabilities(
  signal: AbortSignal,
): Promise<StorageApiReply<StorageCapabilities>> {
  return readApiReply(
    fetch(`${STORAGE_API_V1}/capabilities`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    }),
    capabilitiesSchema,
  );
}

/**
 * Reads one page of the trash: the entries put into it themselves.
 *
 * @param pageToken - The cursor of the page, `null` for the first.
 * @param signal - Ends the request when the view moves on.
 * @returns The page, or why it is not shown.
 */
export async function requestStorageTrash(
  pageToken: string | null,
  signal: AbortSignal,
): Promise<StorageApiReply<StorageListingPage>> {
  const parameters = new URLSearchParams({ ref: "root", trash: "1" });

  if (pageToken !== null) parameters.set("pageToken", pageToken);

  return readApiReply(
    fetch(`${STORAGE_API_V1}/list?${parameters.toString()}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    }),
    listingSchema,
  );
}

function changeBody(change: StorageChange): RequestInit {
  if (change.file === undefined) {
    return {
      body: JSON.stringify(change.fields),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };
  }

  const form = new FormData();

  for (const [name, text] of Object.entries(change.fields)) {
    form.set(name, text);
  }

  form.set("file", change.file);

  return { body: form, headers: { Accept: "application/json" } };
}

/**
 * Runs one changing call of the Storage interface.
 *
 * @param change - The operation, its fields and an optional file.
 * @returns Whether it succeeded, or the error with its confirmation or conflicts.
 *
 * @remarks
 * The result of a change is not used by the view, which reloads the folder
 * afterwards, so only the envelope is checked.
 */
export async function requestStorageChange(
  change: StorageChange,
): Promise<StorageApiReply<unknown>> {
  return readApiReply(
    fetch(`${STORAGE_API_V1}/${change.operation}`, {
      ...changeBody(change),
      credentials: "same-origin",
      method: "POST",
    }),
    z.unknown(),
  );
}

/** One `batch` call: an action for several entries of one folder. */
export interface StorageBatchChange {
  readonly action: StorageBatchAction;
  /** The folder the entries lie in. */
  readonly sourceRef: string;
  readonly refs: readonly string[];
  /** The folder copies and moved entries go to; `null` for `delete`. */
  readonly targetParentRef: string | null;
}

/**
 * Runs one action for several entries of a folder (PAGE-272).
 *
 * @param change - Action, source folder, entries and target folder.
 * @returns How many changed and which were refused, or why the call failed.
 */
export async function requestStorageBatch(
  change: StorageBatchChange,
): Promise<StorageApiReply<StorageBatchResult>> {
  const { targetParentRef, ...fields } = change;

  return readApiReply(
    fetch(`${STORAGE_API_V1}/batch`, {
      body: JSON.stringify(
        targetParentRef === null ? fields : { ...fields, targetParentRef },
      ),
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
    batchResultSchema,
  );
}

/**
 * Builds the download address of a file.
 *
 * @param ref - The Drive identifier of the file.
 * @param format - The export format of a Google document, else `null`.
 * @returns The address; the server answers with an attachment.
 */
export function storageDownloadHref(
  ref: string,
  format: string | null,
): string {
  const parameters = new URLSearchParams({ ref });

  if (format !== null) parameters.set("format", format);

  return `${STORAGE_API_V1}/download?${parameters.toString()}`;
}
