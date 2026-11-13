import { STORAGE_GRANTED_OPERATIONS } from "./StorageAccessService";

import type { StorageAccessService } from "./StorageAccessService";
import type { GoogleDriveFileService } from "./GoogleDriveFileService";
import type { StorageFileReader } from "./StorageFileReader";
import type { StorageFileWriter } from "./StorageFileWriter";
import type { StorageBatchWriter } from "./StorageBatchWriter";
import type {
  StorageCapabilities,
  StorageOperation,
  StorageResult,
} from "@/definition/GoogleDriveFiles";

/** The public Storage surface, scoped to one authenticated Pages account. */
export interface StorageAccountFiles {
  readonly reader: Pick<
    StorageFileReader,
    "list" | "search" | "stat" | "resolvePath" | "read" | "download" | "quota"
  >;
  readonly writer: Pick<
    StorageFileWriter,
    | "createFolder"
    | "upload"
    | "update"
    | "copy"
    | "move"
    | "rename"
    | "trash"
    | "restore"
    | "deletePermanently"
    | "confirm"
  >;
  readonly batch: Pick<StorageBatchWriter, "run">;
  readonly isSimulation: boolean;
  capabilities(folderRef?: string): Promise<StorageResult<StorageCapabilities>>;
}

/** Inputs needed for folder authorization; bytes and confirmations never enter the audit log. */
interface AccessInput {
  readonly ref?: string | null;
  readonly parentRef?: string;
  readonly folderRef?: string | null;
  readonly action?: string;
  readonly isTrash?: boolean;
}

async function accountCapabilities(input: {
  readonly files: GoogleDriveFileService;
  readonly userId: string;
  readonly access: StorageAccessService | null;
  readonly folderRef?: string;
}): Promise<StorageResult<StorageCapabilities>> {
  const { files, userId, access, folderRef } = input;

  const context = await access?.context(userId);
  if (!context || (!context.isAdministrator && context.grants.length === 0))
    return { ok: false, error: { code: "forbidden" } };
  if (folderRef && access && !(await access.contains(context, folderRef)))
    return { ok: false, error: { code: "forbidden" } };
  const result = await files.capabilities();
  if (!result.ok) return result;
  await access?.record(context, "capabilities", folderRef ?? "");
  const operations = context.isAdministrator
    ? result.value.operations
    : result.value.operations.filter((operation) =>
        STORAGE_GRANTED_OPERATIONS.includes(operation),
      );
  return {
    ok: true,
    value: {
      ...result.value,
      operations,
      canRequestWriteAccess:
        context.isAdministrator && result.value.canRequestWriteAccess,
      grantedFolders: context.isAdministrator
        ? undefined
        : context.grants.map((grant) => ({
            ref: grant.folderRef,
            name: grant.folderName,
          })),
    },
  };
}

/** Creates an account-bound facade; callers cannot supply another acting user. */
export function accountStorageFiles(
  files: GoogleDriveFileService,
  userId: string,
  access: StorageAccessService | null,
): StorageAccountFiles {
  async function run<Value>(
    operation: StorageOperation,
    input: AccessInput,
    perform: () => Promise<StorageResult<Value>>,
  ): Promise<StorageResult<Value>> {
    const context = await access?.context(userId);
    if (
      !access ||
      !context ||
      !(await access.allows(context, operation, input))
    )
      return { ok: false, error: { code: "forbidden" } };
    const result = await perform();
    if (result.ok)
      await access.record(
        context,
        operation,
        input.ref ?? input.parentRef ?? input.folderRef ?? "",
      );
    return result;
  }
  const { reader, writer } = files;
  return {
    isSimulation: files.isSimulation,
    capabilities: (folderRef) =>
      accountCapabilities({ files, userId, access, folderRef }),
    reader: {
      list: async (input) => run("list", input, () => reader.list(input)),
      search: async (input) => run("search", input, () => reader.search(input)),
      stat: async (ref) => run("stat", { ref }, () => reader.stat(ref)),
      resolvePath: async (path) => {
        const context = await access?.context(userId);
        if (!access || !context)
          return { ok: false, error: { code: "forbidden" } };
        const result = await reader.resolvePath(path);
        if (!result.ok)
          return context.isAdministrator
            ? result
            : { ok: false, error: { code: "forbidden" } };
        return run(
          "resolve_path",
          { ref: result.value.entry.ref },
          async () => result,
        );
      },
      read: async (ref, format) =>
        run("read", { ref }, () => reader.read(ref, format)),
      download: async (ref, format) =>
        run("download", { ref }, () => reader.download(ref, format)),
      quota: async () => run("quota", {}, () => reader.quota()),
    },
    writer: {
      createFolder: async (input) =>
        run("create_folder", input, () =>
          writer.createFolder({ ...input, userId }),
        ),
      upload: async (input) =>
        run("upload", input, () => writer.upload({ ...input, userId })),
      update: async (input) =>
        run("update", input, () => writer.update({ ...input, userId })),
      confirm: async (input) =>
        run("confirm", input, () => writer.confirm({ ...input, userId })),
      copy: async (input) =>
        run("copy", input, () => writer.copy({ ...input, userId })),
      move: async (input) =>
        run("move", input, () => writer.move({ ...input, userId })),
      rename: async (input) =>
        run("rename", input, () => writer.rename({ ...input, userId })),
      trash: async (input) =>
        run("delete", input, () => writer.trash({ ...input, userId })),
      restore: async (input) =>
        run("restore", input, () => writer.restore({ ...input, userId })),
      deletePermanently: async (input) =>
        run("delete_permanently", input, () =>
          writer.deletePermanently({ ...input, userId }),
        ),
    },
    batch: {
      run: async (input) =>
        run("batch", {}, () => files.batch.run({ ...input, userId })),
    },
  };
}
