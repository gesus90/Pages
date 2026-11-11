import type { GoogleDriveFileService } from "@/backend/service/google/GoogleDriveFileService";
import type { StorageDownload } from "@/backend/service/google/StorageFileReader";
import type {
  StorageOperation,
  StorageResult,
} from "@/definition/GoogleDriveFiles";
import type { McpStorageInput } from "./McpStorageRequest";

/** The metadata, authenticated account and optional bounded file bytes of a call. */
export interface McpStorageCall {
  readonly input: McpStorageInput;
  readonly userId: string;
  readonly bytes: Uint8Array<ArrayBuffer> | null;
}

type StorageHandler = (call: McpStorageCall) => Promise<StorageResult<object>>;

/** Translates the MCP operations into the existing Storage services. */
export class McpStorageService {
  private readonly files: GoogleDriveFileService;

  /** Keeps the shared reader, writer and their server-side confirmations. */
  public constructor(files: GoogleDriveFileService) {
    this.files = files;
  }

  /** Runs a supported JSON operation, without a second persistence or Drive layer. */
  public async run(
    operation: StorageOperation,
    call: McpStorageCall,
  ): Promise<StorageResult<object>> {
    const handler =
      this.readHandlers()[operation] ?? this.writeHandlers()[operation];
    return handler === undefined
      ? { ok: false, error: { code: "invalid_request" } }
      : handler(call);
  }

  /** Opens a file or supported export for an HTTP attachment stream. */
  public async download(
    input: McpStorageInput,
  ): Promise<StorageResult<StorageDownload>> {
    return this.files.reader.download(input.ref, input.format);
  }

  private readHandlers(): Partial<Record<StorageOperation, StorageHandler>> {
    const { reader } = this.files;
    return {
      capabilities: async () => {
        const result = await this.files.capabilities();
        return result.ok
          ? {
              ok: true,
              value: {
                ...result.value,
                operations: result.value.operations.filter(
                  (operation) => operation !== "batch",
                ),
              },
            }
          : result;
      },
      quota: async () => reader.quota(),
      list: async ({ input }) => {
        const page = await reader.list({
          ref: input.ref || "root",
          isTrash:
            input.trash === true ||
            input.trash === "1" ||
            input.trash === "true",
          pageSize: input.pageSize,
          pageToken: input.pageToken,
        });
        return page.ok
          ? {
              ok: true,
              value: { ...page.value, nextCursor: page.value.nextPageToken },
            }
          : page;
      },
      search: async ({ input }) => {
        const page = await reader.search({
          text: input.query,
          folderRef: input.folderRef,
          pageSize: input.pageSize,
          pageToken: input.pageToken,
        });
        return page.ok
          ? {
              ok: true,
              value: { ...page.value, nextCursor: page.value.nextPageToken },
            }
          : page;
      },
      stat: async ({ input }) => reader.stat(input.ref),
      resolve_path: async ({ input }) => reader.resolvePath(input.path),
      read: async ({ input }) => reader.read(input.ref, input.format),
    };
  }

  private writeHandlers(): Partial<Record<StorageOperation, StorageHandler>> {
    const { writer } = this.files;
    return {
      create_folder: async ({ input, userId }) =>
        writer.createFolder({
          name: input.name,
          parentRef: input.parentRef,
          onConflict: input.onConflict,
          userId,
        }),
      copy: async ({ input, userId }) =>
        writer.copy({
          ref: input.ref,
          name: input.name || null,
          targetParentRef: input.targetParentRef,
          onConflict: input.onConflict,
          userId,
        }),
      move: async ({ input, userId }) =>
        writer.move({
          ref: input.ref,
          targetParentRef: input.targetParentRef ?? "",
          onConflict: input.onConflict,
          userId,
        }),
      rename: async ({ input, userId }) =>
        writer.rename({
          ref: input.ref,
          name: input.name,
          onConflict: input.onConflict,
          userId,
        }),
      delete: async ({ input, userId }) =>
        writer.trash({
          ref: input.ref,
          confirmation: input.confirmation,
          userId,
        }),
      restore: async ({ input, userId }) =>
        writer.restore({
          ref: input.ref,
          userId,
        }),
      delete_permanently: async ({ input, userId }) =>
        writer.deletePermanently({
          ref: input.ref,
          confirmation: input.confirmation,
          userId,
        }),
      confirm: async ({ input, userId }) =>
        input.action === undefined
          ? { ok: false, error: { code: "invalid_request" } }
          : writer.confirm({ ref: input.ref, action: input.action, userId }),
      upload: async (call) => this.transfer("upload", call),
      update: async (call) => this.transfer("update", call),
    };
  }

  private async transfer(
    operation: "upload" | "update",
    call: McpStorageCall,
  ): Promise<StorageResult<object>> {
    const { input, userId, bytes } = call;
    if (bytes === null)
      return { ok: false, error: { code: "invalid_request" } };
    const content = {
      bytes,
      userId,
      mimeType: input.mimeType,
      confirmation: input.confirmation,
    };
    return operation === "upload"
      ? this.files.writer.upload({
          ...content,
          name: input.name,
          parentRef: input.parentRef,
          onConflict: input.onConflict,
        })
      : this.files.writer.update({ ...content, ref: input.ref });
  }
}
