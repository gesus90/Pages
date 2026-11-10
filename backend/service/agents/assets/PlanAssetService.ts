import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { AgentError } from "@/backend/error/AgentErrors";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";
import { sanitizeFileName } from "@/backend/service/wiki/WikiFileTypes";
import { countCharacters, WIKI_LIMITS } from "@/definition/Wiki";
import { PLAN_HANDOVER_LIMITS } from "@/definition/AgentPlanHandover";
import { logCaughtError } from "@/backend/logging/Logger";

import { assetRepresentation } from "../AgentAssetRepresentations";
import { detectPlanAssetType } from "./PlanAssetFileType";

import type { ReadStream } from "node:fs";
import type {
  AgentPlanAssetRepository,
  StoredPlanAsset,
} from "@/backend/database/repositories/agents/AgentPlanAssetRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type { AgentContentAccess } from "@/backend/service/agents/AgentContentAccess";
import type { AgentPlanAssetRecord } from "@/definition/AgentPlanAsset";
import type { PlanAssetFileType } from "./PlanAssetFileType";

/** Where the store and the access policy of plan assets come from. */
export interface PlanAssetDependencies {
  readonly repository: AgentPlanAssetRepository;
  readonly files: WikiFileStore;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly content: Pick<AgentContentAccess, "canReadProject">;
}

/** An upload as the route received it: the body is streamed, never buffered. */
export interface PlanAssetUpload {
  readonly projectId: string;
  readonly fileName: string;
  readonly contentLength: number | null;
  readonly body: AsyncIterable<Uint8Array>;
}

/** A result file a node wrote, with the run and the input it belongs to. */
export interface PlanAssetResult {
  readonly projectId: string;
  readonly fileName: string;
  readonly bytes: Buffer;
  readonly origin: {
    readonly runId: string;
    readonly stepId: string;
    readonly sourceAssetId: string | null;
  };
}

/** An opened plan asset: its description and a stream of exactly its bytes. */
export interface OpenedPlanAsset {
  readonly record: AgentPlanAssetRecord;
  readonly stream: Readable;
}

/** The largest file Pages reads into memory at once; larger files are streamed. */
const MAX_READ_BYTES = 64 * 1024 * 1024;
/** Files up to the in-memory budget of a handover are checked for complete content, larger ones only for their bytes. */
const CONTENT_CHECK_BYTES = PLAN_HANDOVER_LIMITS.inlineBytes;

function toRecord(asset: StoredPlanAsset): AgentPlanAssetRecord {
  return {
    assetId: asset.id,
    projectId: asset.projectId,
    fileName: asset.fileName,
    mediaType: asset.mediaType,
    kind: asset.kind,
    size: asset.size,
    digest: asset.checksum,
    createdAt: asset.createdAt,
    origin:
      asset.originRunId && asset.originStepId
        ? {
            runId: asset.originRunId,
            stepId: asset.originStepId,
            sourceAssetId: asset.originAssetId,
          }
        : null,
  };
}

/** Resolves once the stream opened its file, so a missing file fails before any byte is sent. */
function opened(stream: ReadStream): Promise<Readable> {
  return new Promise((resolve, reject) => {
    stream.once("ready", () => resolve(stream));
    stream.once("error", reject);
  });
}

/**
 * Stores the files of asset nodes and hands them out under the plan's project rights.
 *
 * @remarks
 * Every read, preview and handover checks again that the person is active
 * and may read the project the file belongs to; an unknown file and a file
 * the person may not read are the same `plan_asset_missing`, so no foreign
 * file is disclosed. The type comes from the content. Nothing here deletes a
 * file: results and inputs stay.
 */
export class PlanAssetService {
  private readonly dependencies: PlanAssetDependencies;

  public constructor(dependencies: PlanAssetDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Streams an upload to the store after checking the project, the name and the size.
   *
   * @remarks
   * A file may have up to 512 MiB (`PLAN_HANDOVER_LIMITS.bytes`), the same
   * budget a step receives, so an accepted file can always be handed over.
   * The limit is checked against the announced length first and then against
   * the bytes as they arrive, so a longer body is cut off, never stored.
   *
   * @throws {AgentError} `plan_asset_missing` without access to the project,
   * `plan_asset_invalid` for an empty file or an invalid name,
   * `plan_asset_too_large` beyond the upload limit.
   */
  public async upload(
    userId: string,
    upload: PlanAssetUpload,
  ): Promise<AgentPlanAssetRecord> {
    await this.requireProject(userId, upload.projectId);
    const fileName = sanitizeFileName(upload.fileName);
    if (countCharacters(fileName) > WIKI_LIMITS.fileNameLength)
      throw new AgentError("plan_asset_invalid");
    const limit = PLAN_HANDOVER_LIMITS.bytes;
    if (upload.contentLength !== null && upload.contentLength > limit)
      throw new AgentError("plan_asset_too_large");
    let type: PlanAssetFileType = { mediaType: "", kind: "other" };
    const stored = await this.dependencies.files
      .write(upload.body, {
        absoluteLimit: limit,
        limitFor: (head) => {
          type = detectPlanAssetType(head, fileName);
          return limit;
        },
      })
      .catch((error: unknown) => {
        logCaughtError("PlanAssetService", error);
        throw error instanceof FileTooLargeError
          ? new AgentError("plan_asset_too_large")
          : error;
      });
    if (stored.size === 0) {
      await this.dependencies.files.remove([stored.storageName]);
      throw new AgentError("plan_asset_invalid");
    }
    return this.insert({
      projectId: upload.projectId,
      ownerId: userId,
      fileName,
      type,
      stored,
      origin: null,
    });
  }

  /** Stores a result file a node wrote; the caller already holds the run's rights. */
  public async storeResult(
    userId: string,
    result: PlanAssetResult,
  ): Promise<AgentPlanAssetRecord> {
    await this.requireProject(userId, result.projectId);
    const fileName = sanitizeFileName(result.fileName);
    const type = detectPlanAssetType(result.bytes.subarray(0, 4096), fileName);
    const stored = await this.dependencies.files.write(
      Readable.from([result.bytes]),
      {
        absoluteLimit: PLAN_HANDOVER_LIMITS.bytes,
        limitFor: () => PLAN_HANDOVER_LIMITS.bytes,
      },
    );
    return this.insert({
      projectId: result.projectId,
      ownerId: userId,
      fileName,
      type,
      stored,
      origin: result.origin,
    });
  }

  /**
   * Describes a file the person may read.
   *
   * @throws {AgentError} `plan_asset_missing` for an unknown file and for a
   * file of a project the person may not read.
   */
  public async describe(
    userId: string,
    assetId: string,
  ): Promise<AgentPlanAssetRecord> {
    return toRecord(await this.readable(userId, assetId));
  }

  /**
   * Opens a file the person may read.
   *
   * @throws {AgentError} `plan_asset_missing` as for {@link describe},
   * `plan_asset_unreadable` when the stored bytes are gone.
   */
  public async open(userId: string, assetId: string): Promise<OpenedPlanAsset> {
    const asset = await this.readable(userId, assetId);
    try {
      const stream = await opened(
        this.dependencies.files.open(asset.storageName),
      );
      return { record: toRecord(asset), stream };
    } catch (error: unknown) {
      logCaughtError("PlanAssetService", error);
      throw new AgentError("plan_asset_unreadable");
    }
  }

  /**
   * Reads a whole file the person may read and checks it against its stored digest.
   *
   * @throws {AgentError} `plan_asset_unreadable` when bytes are missing,
   * shorter or longer than stored, `plan_asset_too_large` beyond the read limit.
   */
  public async read(userId: string, assetId: string): Promise<Buffer> {
    const { record, stream } = await this.open(userId, assetId);
    if (record.size > MAX_READ_BYTES) {
      stream.destroy();
      throw new AgentError("plan_asset_too_large");
    }
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of stream)
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    } catch (error: unknown) {
      logCaughtError("PlanAssetService", error);
      throw new AgentError("plan_asset_unreadable");
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== record.size)
      throw new AgentError("plan_asset_unreadable");
    return bytes;
  }

  /**
   * Whether a file the person may read can be handed over: its bytes are all
   * there and an image or PDF is complete.
   *
   * @remarks
   * Files above the handover limit are only checked for their bytes; their
   * content is never read into memory for this.
   */
  public async isReadable(userId: string, assetId: string): Promise<boolean> {
    const record = await this.describe(userId, assetId);
    try {
      if (record.size > CONTENT_CHECK_BYTES) {
        (await this.open(userId, assetId)).stream.destroy();
        return true;
      }
      const bytes = await this.read(userId, assetId);
      if (record.kind === "image" || record.mediaType === "application/pdf")
        await assetRepresentation(bytes);
      return true;
    } catch (error: unknown) {
      logCaughtError("PlanAssetService", error);
      return false;
    }
  }

  private async insert(input: {
    readonly projectId: string;
    readonly ownerId: string;
    readonly fileName: string;
    readonly type: PlanAssetFileType;
    readonly stored: Awaited<ReturnType<WikiFileStore["write"]>>;
    readonly origin: PlanAssetResult["origin"] | null;
  }): Promise<AgentPlanAssetRecord> {
    try {
      return toRecord(
        await this.dependencies.repository.insert({
          id: randomUUID(),
          projectId: input.projectId,
          ownerId: input.ownerId,
          fileName: input.fileName,
          mediaType: input.type.mediaType || "application/octet-stream",
          kind: input.type.kind,
          size: input.stored.size,
          checksum: input.stored.checksum,
          storageName: input.stored.storageName,
          originRunId: input.origin?.runId ?? null,
          originStepId: input.origin?.stepId ?? null,
          originAssetId: input.origin?.sourceAssetId ?? null,
        }),
      );
    } catch (error: unknown) {
      logCaughtError("PlanAssetService", error);
      await this.dependencies.files.remove([input.stored.storageName]);
      throw error;
    }
  }

  private async readable(
    userId: string,
    assetId: string,
  ): Promise<StoredPlanAsset> {
    const asset = await this.dependencies.repository.find(assetId);
    if (!asset) throw new AgentError("plan_asset_missing");
    await this.requireProject(userId, asset.projectId);
    return asset;
  }

  private async requireProject(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const snapshot = await this.dependencies.authorization.snapshot();
    const actor = snapshot.accounts.find((entry) => entry.userId === userId);
    if (
      !actor?.isActive ||
      !(await this.dependencies.content.canReadProject(actor, projectId))
    )
      throw new AgentError("plan_asset_missing");
  }
}
