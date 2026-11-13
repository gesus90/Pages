import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  queryParameters,
  readBodyParameters,
  readConflictPolicy,
  readPageSize,
  readPageToken,
  storageDownloadResponse,
  storageErrorResponse,
  storageResponse,
} from "@/app/lib/storage-api.server";
import { logCaughtError } from "@/backend/logging/Logger";
import { STORAGE_MAX_UPLOAD_BYTES } from "@/backend/service/google/StorageFileWriter";
import { STORAGE_OPERATIONS } from "@/definition/GoogleDriveFiles";

import type { StorageParameters } from "@/app/lib/storage-api.server";
import type { StorageAccountFiles } from "@/backend/service/google/StorageAccountFiles";
import type {
  StorageConfirmableAction,
  StorageOperation,
  StorageResult,
} from "@/definition/GoogleDriveFiles";
import type { User } from "@/definition/User";
import type { Route } from "./+types/storage-api-v1";

const CONFIRMABLE_ACTIONS: readonly StorageConfirmableAction[] = [
  "delete",
  "delete_permanently",
  "update",
  "overwrite",
];

/** One call after the Pages right was checked. */
interface StorageCall {
  readonly files: StorageAccountFiles;
  readonly user: User;
  readonly parameters: StorageParameters;
}

function readOperation(text: string | undefined): StorageOperation | null {
  return STORAGE_OPERATIONS.find((operation) => operation === text) ?? null;
}

function methodNotAllowed(allowed: "GET" | "POST"): Response {
  return new Response("Method Not Allowed", {
    headers: { Allow: allowed },
    status: 405,
  });
}

/** Binds all operations to the signed-in account, with fresh checks per call. */
async function grantedFiles(
  user: User | null,
): Promise<StorageAccountFiles | null> {
  if (!user) return null;
  return (await getApplicationServices()).googleDriveFileService.forAccount(
    user.id,
  );
}

function required(parameters: StorageParameters, name: string): string {
  return parameters.text(name) ?? "";
}

type ReadHandler = (call: StorageCall) => Promise<Response>;
type ChangeHandler = (call: StorageCall) => Promise<StorageResult<unknown>>;

function answer<Value>(
  call: StorageCall,
  result: StorageResult<Value>,
): Response {
  return storageResponse(result, call.files.isSimulation);
}

async function runDownload(call: StorageCall): Promise<Response> {
  const download = await call.files.reader.download(
    required(call.parameters, "ref"),
    call.parameters.text("format"),
  );

  return download.ok
    ? storageDownloadResponse(download.value, call.files.isSimulation)
    : storageErrorResponse(download.error, call.files.isSimulation);
}

/** The reading operations; each answers `GET`. */
const READ_HANDLERS: Partial<Record<StorageOperation, ReadHandler>> = {
  capabilities: async (call) =>
    answer(
      call,
      await call.files.capabilities(call.parameters.text("ref") ?? undefined),
    ),
  download: runDownload,
  list: async (call) =>
    answer(
      call,
      await call.files.reader.list({
        isTrash: call.parameters.text("trash") === "1",
        pageSize: readPageSize(call.parameters),
        pageToken: readPageToken(call.parameters),
        ref: call.parameters.text("ref") ?? "root",
      }),
    ),
  quota: async (call) => answer(call, await call.files.reader.quota()),
  read: async (call) =>
    answer(
      call,
      await call.files.reader.read(
        required(call.parameters, "ref"),
        call.parameters.text("format"),
      ),
    ),
  resolve_path: async (call) =>
    answer(
      call,
      await call.files.reader.resolvePath(required(call.parameters, "path")),
    ),
  search: async (call) =>
    answer(
      call,
      await call.files.reader.search({
        folderRef: call.parameters.text("folder"),
        pageSize: readPageSize(call.parameters),
        pageToken: readPageToken(call.parameters),
        text: required(call.parameters, "query"),
      }),
    ),
  stat: async (call) =>
    answer(
      call,
      await call.files.reader.stat(required(call.parameters, "ref")),
    ),
};

async function runTransfer(
  operation: "upload" | "update",
  call: StorageCall,
): Promise<StorageResult<unknown>> {
  const { parameters, user } = call;
  const file = parameters.file("file");

  if (!file) {
    return { error: { code: "invalid_request" }, ok: false };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const confirmation = parameters.text("confirmation");

  return operation === "upload"
    ? call.files.writer.upload({
        bytes,
        confirmation,
        mimeType,
        name: parameters.text("name") ?? file.name,
        onConflict: readConflictPolicy(parameters),
        parentRef: parameters.text("parentRef") ?? "root",
        userId: user.id,
      })
    : call.files.writer.update({
        bytes,
        confirmation,
        mimeType,
        ref: required(parameters, "ref"),
        userId: user.id,
      });
}

async function runConfirm(call: StorageCall): Promise<StorageResult<unknown>> {
  const confirmable = CONFIRMABLE_ACTIONS.find(
    (candidate) => candidate === call.parameters.text("action"),
  );

  return confirmable === undefined
    ? { error: { code: "invalid_request" }, ok: false }
    : call.files.writer.confirm({
        action: confirmable,
        ref: required(call.parameters, "ref"),
        userId: call.user.id,
      });
}

function entryAction(call: StorageCall): {
  readonly confirmation: string | null;
  readonly ref: string;
  readonly userId: string;
} {
  return {
    confirmation: call.parameters.text("confirmation"),
    ref: required(call.parameters, "ref"),
    userId: call.user.id,
  };
}

/** The changing operations; each answers `POST`. */
const CHANGE_HANDLERS: Partial<Record<StorageOperation, ChangeHandler>> = {
  batch: async (call) =>
    call.files.batch.run({
      action: call.parameters.text("action"),
      refs: call.parameters.list("refs"),
      sourceRef: call.parameters.text("sourceRef"),
      targetParentRef: call.parameters.text("targetParentRef"),
      userId: call.user.id,
    }),
  confirm: runConfirm,
  copy: async (call) =>
    call.files.writer.copy({
      name: call.parameters.text("name"),
      onConflict: readConflictPolicy(call.parameters),
      ref: required(call.parameters, "ref"),
      targetParentRef: call.parameters.text("targetParentRef"),
      userId: call.user.id,
    }),
  create_folder: async (call) =>
    call.files.writer.createFolder({
      name: required(call.parameters, "name"),
      onConflict: readConflictPolicy(call.parameters),
      parentRef: call.parameters.text("parentRef") ?? "root",
      userId: call.user.id,
    }),
  delete: async (call) => call.files.writer.trash(entryAction(call)),
  delete_permanently: async (call) =>
    call.files.writer.deletePermanently(entryAction(call)),
  move: async (call) =>
    call.files.writer.move({
      onConflict: readConflictPolicy(call.parameters),
      ref: required(call.parameters, "ref"),
      targetParentRef: required(call.parameters, "targetParentRef"),
      userId: call.user.id,
    }),
  rename: async (call) =>
    call.files.writer.rename({
      name: required(call.parameters, "name"),
      onConflict: readConflictPolicy(call.parameters),
      ref: required(call.parameters, "ref"),
      userId: call.user.id,
    }),
  restore: async (call) => call.files.writer.restore(entryAction(call)),
  update: async (call) => runTransfer("update", call),
  upload: async (call) => runTransfer("upload", call),
};

/**
 * Answers the reading operations of the Storage interface (PAGE-270):
 * `list`, `search`, `stat`, `resolve_path`, `read`, `download`, `quota` and
 * `capabilities`, see `docs/StorageApi.md`.
 */
export async function loader({
  context,
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const operation = readOperation(params.operation);

  if (operation === null) {
    return storageErrorResponse({ code: "invalid_request" }, false);
  }

  const handler = READ_HANDLERS[operation];

  if (!handler) {
    return methodNotAllowed("POST");
  }

  const user = context.get(authenticatedUserContext);
  const files = await grantedFiles(user);

  if (!user || !files) {
    return storageErrorResponse({ code: "forbidden" }, false);
  }

  try {
    return await handler({
      files,
      parameters: queryParameters(new URL(request.url)),
      user,
    });
  } catch (error: unknown) {
    logCaughtError("storage_api_v1", error);

    return storageErrorResponse({ code: "failed" }, files.isSimulation);
  }
}

/**
 * Answers the changing operations of the Storage interface (PAGE-270):
 * `upload`, `update`, `copy`, `move`, `rename`, `delete`, `create_folder`,
 * `restore`, `delete_permanently`, `confirm` and `batch`, see
 * `docs/StorageApi.md`.
 */
export async function action({
  context,
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  const operation = readOperation(params.operation);

  if (operation === null) {
    return storageErrorResponse({ code: "invalid_request" }, false);
  }

  const handler = CHANGE_HANDLERS[operation];

  if (!handler || request.method !== "POST") {
    return methodNotAllowed(handler ? "POST" : "GET");
  }

  const user = context.get(authenticatedUserContext);
  const files = await grantedFiles(user);

  if (!user || !files) {
    return storageErrorResponse({ code: "forbidden" }, false);
  }

  try {
    const parameters = await readBodyParameters(
      request,
      STORAGE_MAX_UPLOAD_BYTES,
    );

    if (parameters === null || parameters === "too_large") {
      return storageErrorResponse(
        parameters === null
          ? { code: "invalid_request" }
          : { code: "too_large", limitBytes: STORAGE_MAX_UPLOAD_BYTES },
        files.isSimulation,
      );
    }

    return storageResponse(
      await handler({ files, parameters, user }),
      files.isSimulation,
    );
  } catch (error: unknown) {
    logCaughtError("storage_api_v1", error);

    return storageErrorResponse({ code: "failed" }, files.isSimulation);
  }
}
