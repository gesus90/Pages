import { randomUUID } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { FileTooLargeError } from "@/backend/storage/WikiFileStore";
import {
  detectFileType,
  sanitizeFileName,
} from "@/backend/service/wiki/WikiFileTypes";
import { WIKI_LIMITS, countCharacters } from "@/definition/Wiki";

import type {
  AgentAssetRepository,
  StoredAgentAsset,
} from "@/backend/database/repositories/agents/AgentAssetRepository";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type { UploadedFile, WikiService } from "@/backend/service/WikiService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { AgentAsset } from "@/definition/PagesAgentWrites";
import type { User } from "@/definition/User";
import type { DetectedFileType } from "@/backend/service/wiki/WikiFileTypes";

/** Storage and existing wiki policy shared by uploads and downloads. */
export interface AgentAssetDependencies {
  readonly repository: AgentAssetRepository;
  readonly files: WikiFileStore;
  readonly wiki: Pick<WikiService, "getSettings" | "openAttachment">;
}

/** Stages streamed uploads and expires only assets that were never linked. */
export class AgentAssetService {
  private readonly dependencies: AgentAssetDependencies;

  public constructor(dependencies: AgentAssetDependencies) {
    this.dependencies = dependencies;
  }

  /** Rejects invalid names before issuing a capability or writing bytes. */
  public validateFileName(fileName: string): string {
    const cleaned = sanitizeFileName(fileName);
    if (countCharacters(cleaned) > WIKI_LIMITS.fileNameLength)
      throw new AgentOperationError("INVALID_REQUEST");
    return cleaned;
  }

  /** Streams to staging, enforcing current limits and rechecking the originating authority before persistence. */
  public async upload(
    file: UploadedFile,
    revalidate: () => Promise<AgentIdentity>,
  ): Promise<AgentAsset> {
    const identity = await revalidate();
    this.requireWrite(identity);
    const fileName = this.validateFileName(file.fileName);
    const limits = await this.dependencies.wiki.getSettings();
    const absoluteLimit = Math.max(
      limits.mediaLimitBytes,
      limits.fileLimitBytes,
    );
    if (file.contentLength !== null && file.contentLength > absoluteLimit)
      throw new AgentOperationError("PAYLOAD_TOO_LARGE");
    let type: DetectedFileType = detectFileType(Buffer.alloc(0));
    const stored = await this.dependencies.files
      .write(file.body, {
        absoluteLimit,
        limitFor: (head) => {
          type = detectFileType(head);
          return type.kind === "media"
            ? limits.mediaLimitBytes
            : limits.fileLimitBytes;
        },
      })
      .catch((error: unknown) => {
        throw error instanceof FileTooLargeError
          ? new AgentOperationError("PAYLOAD_TOO_LARGE")
          : error;
      });
    try {
      if (stored.size === 0) throw new AgentOperationError("INVALID_REQUEST");
      const current = await revalidate();
      this.requireWrite(current);
      if (current.userId !== identity.userId)
        throw new AgentOperationError("FORBIDDEN");
      const asset: StoredAgentAsset = {
        ...stored,
        id: randomUUID(),
        userId: current.userId,
        status: "staged",
        fileName,
        contentType: type.contentType,
        kind: type.kind,
        pageId: null,
        attachmentId: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + 86_400_000,
      };
      await this.dependencies.repository.insert(asset);
      return {
        assetId: asset.id,
        link: `/agent-assets/${asset.id}`,
        fileName,
        contentType: asset.contentType,
        size: stored.size,
        expiresAt: asset.expiresAt,
      };
    } catch (error: unknown) {
      await this.dependencies.files.remove([stored.storageName]);
      throw error;
    }
  }

  /** Opens owned staging or a linked attachment under the existing browser wiki policy. */
  public async open(
    actor: User,
    id: string,
  ): Promise<{
    readonly fileName: string;
    readonly contentType: string;
    readonly size: number;
    readonly stream: ReturnType<WikiFileStore["open"]>;
  }> {
    const asset = await this.dependencies.repository.find(id);
    if (!asset) throw new WikiPageNotFoundError();
    if (asset.status === "linked" && asset.attachmentId !== null) {
      const opened = await this.dependencies.wiki.openAttachment(
        actor,
        asset.attachmentId,
      );
      return { ...opened.attachment, stream: opened.stream };
    }
    if (
      asset.userId !== actor.id ||
      asset.status !== "staged" ||
      asset.expiresAt <= Date.now()
    )
      throw new WikiPageNotFoundError();
    return {
      fileName: asset.fileName,
      contentType: asset.contentType,
      size: asset.size,
      stream: this.dependencies.files.open(asset.storageName),
    };
  }

  /** Retries failed expiry deletions and sweeps old interrupted uploads and promoted originals. */
  public async runMaintenance(): Promise<void> {
    for (const asset of await this.dependencies.repository.expired(
      Date.now(),
    )) {
      await this.dependencies.repository.markExpired(asset.id);
      await this.dependencies.files.remove([asset.storageName]);
      await this.dependencies.repository.remove(asset.id);
    }
    await this.dependencies.files.sweep(
      new Set(await this.dependencies.repository.stagedStorageNames()),
      3_600_000,
    );
  }

  private requireWrite(identity: AgentIdentity): void {
    if (!identity.isAdmin && !identity.permissions.includes("write"))
      throw new AgentOperationError("FORBIDDEN");
  }
}
