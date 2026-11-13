import { PICA_STORAGE_SCHEMAS } from "./PicaStorageContracts";

import type { StorageAccountFiles } from "@/backend/service/google/StorageAccountFiles";
import type { StorageResult } from "@/definition/GoogleDriveFiles";
import type { PicaStorageTool } from "./PicaStorageContracts";

/** The part of the Storage interface (PAGE-270) the native tools use. */
export type PicaStorageFiles = Pick<
  StorageAccountFiles,
  "reader" | "writer" | "capabilities" | "isSimulation"
>;

/** Who acts, and the server-held confirmation token the person approved for exactly this call. */
export interface PicaStorageActor {
  readonly userId: string;
  readonly confirmation: string | null;
}

/** Runs one tool against the Storage interface. */
type StorageHandler = (
  files: PicaStorageFiles,
  input: unknown,
  actor: PicaStorageActor,
) => Promise<StorageResult<unknown>>;

/** The address of the download operation; the route checks the rights again on every request. */
const DOWNLOAD_PATH = "/storage-api/v1/download";

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

function decodeContent(input: {
  readonly content: string;
  readonly encoding: "text" | "base64";
}): Uint8Array<ArrayBuffer> | null {
  if (input.encoding === "text")
    return new Uint8Array(Buffer.from(input.content, "utf8"));
  const compact = input.content.replace(/\s/gu, "");
  return compact.length % 4 === 0 && BASE64.test(compact)
    ? new Uint8Array(Buffer.from(compact, "base64"))
    : null;
}

function invalidContent(): StorageResult<never> {
  return { ok: false, error: { code: "invalid_request" } };
}

/**
 * Checks a download the same way the route does and names its address.
 *
 * @remarks
 * The stream is opened to find a missing file, a missing right or an
 * unsupported format now, and closed at once: the bytes reach the person
 * through the route, never the model.
 */
async function prepareDownload(
  files: PicaStorageFiles,
  input: unknown,
): Promise<StorageResult<unknown>> {
  const { ref, format } = PICA_STORAGE_SCHEMAS.storage_download.parse(input);
  const download = await files.reader.download(ref, format ?? null);
  if (!download.ok) return download;
  await download.value.media.body?.cancel();
  const query = new URLSearchParams({ ref: download.value.entry.ref });
  if (format !== undefined) query.set("format", format);
  return {
    ok: true,
    value: {
      entry: download.value.entry,
      fileName: download.value.fileName,
      mimeType: download.value.media.mimeType,
      sizeBytes: download.value.media.sizeBytes,
      downloadPath: `${DOWNLOAD_PATH}?${query.toString()}`,
    },
  };
}

async function upload(
  files: PicaStorageFiles,
  input: unknown,
  actor: PicaStorageActor,
): Promise<StorageResult<unknown>> {
  const parameters = PICA_STORAGE_SCHEMAS.storage_upload.parse(input);
  const bytes = decodeContent(parameters);
  if (bytes === null) return invalidContent();
  return files.writer.upload({
    bytes,
    confirmation: actor.confirmation,
    mimeType: parameters.mimeType,
    name: parameters.name,
    onConflict: parameters.onConflict ?? "fail",
    parentRef: parameters.parentRef ?? "root",
    userId: actor.userId,
  });
}

async function update(
  files: PicaStorageFiles,
  input: unknown,
  actor: PicaStorageActor,
): Promise<StorageResult<unknown>> {
  const parameters = PICA_STORAGE_SCHEMAS.storage_update.parse(input);
  const bytes = decodeContent(parameters);
  if (bytes === null) return invalidContent();
  return files.writer.update({
    bytes,
    confirmation: actor.confirmation,
    mimeType: parameters.mimeType,
    ref: parameters.ref,
    userId: actor.userId,
  });
}

/** The reading tools; they never change Drive. */
const READ_HANDLERS = {
  storage_capabilities: async (files) => files.capabilities(),
  storage_quota: async (files) => files.reader.quota(),
  storage_list: async (files, input) => {
    const parameters = PICA_STORAGE_SCHEMAS.storage_list.parse(input);
    return files.reader.list({
      isTrash: parameters.trash === true,
      pageSize: parameters.pageSize ?? null,
      pageToken: parameters.pageToken ?? null,
      ref: parameters.ref ?? "root",
    });
  },
  storage_search: async (files, input) => {
    const parameters = PICA_STORAGE_SCHEMAS.storage_search.parse(input);
    return files.reader.search({
      folderRef: parameters.folderRef ?? null,
      pageSize: parameters.pageSize ?? null,
      pageToken: parameters.pageToken ?? null,
      text: parameters.query,
    });
  },
  storage_stat: async (files, input) =>
    files.reader.stat(PICA_STORAGE_SCHEMAS.storage_stat.parse(input).ref),
  storage_resolve_path: async (files, input) =>
    files.reader.resolvePath(
      PICA_STORAGE_SCHEMAS.storage_resolve_path.parse(input).path,
    ),
  storage_read: async (files, input) => {
    const { ref, format } = PICA_STORAGE_SCHEMAS.storage_read.parse(input);
    return files.reader.read(ref, format ?? null);
  },
  storage_download: prepareDownload,
} satisfies Partial<Record<PicaStorageTool, StorageHandler>>;

/** The changing tools; each goes through the checks of the Storage interface. */
const CHANGE_HANDLERS = {
  storage_upload: upload,
  storage_update: update,
  storage_copy: async (files, input, actor) => {
    const parameters = PICA_STORAGE_SCHEMAS.storage_copy.parse(input);
    return files.writer.copy({
      name: parameters.name ?? null,
      onConflict: parameters.onConflict ?? "fail",
      ref: parameters.ref,
      targetParentRef: parameters.targetParentRef ?? null,
      userId: actor.userId,
    });
  },
  storage_move: async (files, input, actor) => {
    const parameters = PICA_STORAGE_SCHEMAS.storage_move.parse(input);
    return files.writer.move({
      onConflict: parameters.onConflict ?? "fail",
      ref: parameters.ref,
      targetParentRef: parameters.targetParentRef,
      userId: actor.userId,
    });
  },
  storage_rename: async (files, input, actor) => {
    const parameters = PICA_STORAGE_SCHEMAS.storage_rename.parse(input);
    return files.writer.rename({
      name: parameters.name,
      onConflict: parameters.onConflict ?? "fail",
      ref: parameters.ref,
      userId: actor.userId,
    });
  },
  storage_trash: async (files, input, actor) =>
    files.writer.trash({
      confirmation: actor.confirmation,
      ref: PICA_STORAGE_SCHEMAS.storage_trash.parse(input).ref,
      userId: actor.userId,
    }),
  storage_restore: async (files, input, actor) =>
    files.writer.restore({
      ref: PICA_STORAGE_SCHEMAS.storage_restore.parse(input).ref,
      userId: actor.userId,
    }),
  storage_create_folder: async (files, input, actor) => {
    const parameters = PICA_STORAGE_SCHEMAS.storage_create_folder.parse(input);
    return files.writer.createFolder({
      name: parameters.name,
      onConflict: parameters.onConflict ?? "fail",
      parentRef: parameters.parentRef ?? "root",
      userId: actor.userId,
    });
  },
  storage_delete_permanently: async (files, input, actor) =>
    files.writer.deletePermanently({
      confirmation: actor.confirmation,
      ref: PICA_STORAGE_SCHEMAS.storage_delete_permanently.parse(input).ref,
      userId: actor.userId,
    }),
} satisfies Partial<Record<PicaStorageTool, StorageHandler>>;

/** Every native Storage tool with its handler. */
export const PICA_STORAGE_HANDLERS: Readonly<
  Record<PicaStorageTool, StorageHandler>
> = { ...READ_HANDLERS, ...CHANGE_HANDLERS };
