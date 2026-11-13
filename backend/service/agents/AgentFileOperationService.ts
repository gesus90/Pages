import { createHash } from "node:crypto";

import { STORAGE_OPERATIONS } from "@/definition/GoogleDriveFiles";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { readMcpStorageInput } from "@/backend/service/mcp/storage/McpStorageRequest";
import { McpStorageService } from "@/backend/service/mcp/storage/McpStorageService";
import {
  AGENT_FILE_READ_OPERATIONS,
  AGENT_FILE_WRITE_OPERATIONS,
} from "@/definition/AgentFileOperations";
import {
  REPOSITORY_READ_SCHEMAS,
  RepositoryReadError,
} from "@/definition/RepositoryRead";

import type { StorageOperationRepository } from "@/backend/database/repositories/google/StorageOperationRepository";
import type { GoogleDriveFileService } from "@/backend/service/google/GoogleDriveFileService";
import type { StorageAccessService } from "@/backend/service/google/StorageAccessService";
import type { RepositoryReadService } from "@/backend/service/github/RepositoryReadService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { StorageResult } from "@/definition/GoogleDriveFiles";
import type { RepositoryReadTool } from "@/definition/RepositoryRead";

/** The existing account-bound services, shared by plan tools and HTTP routes. */
export interface AgentFileDependencies {
  readonly files: GoogleDriveFileService;
  readonly access: StorageAccessService;
  readonly repositories: Pick<RepositoryReadService, "run">;
  readonly receipts: Pick<StorageOperationRepository, "claim" | "finish">;
}

function decodeStorageContent(
  input: Readonly<Record<string, unknown>>,
): Uint8Array<ArrayBuffer> | null {
  if (typeof input.content !== "string") return null;
  if (input.encoding === "text") return new TextEncoder().encode(input.content);
  if (
    input.encoding !== "base64" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      input.content,
    )
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return new Uint8Array(Buffer.from(input.content, "base64"));
}

function storageResult(result: StorageResult<object>): PagesAgentReadResponse {
  if (!result.ok && result.error.code === "forbidden")
    throw new AgentOperationError("FORBIDDEN");
  return { apiVersion: "1", result: { storage: result } };
}

/** Implements the bridge operations without starting a transport or exposing a checkout. */
export class AgentFileOperationService {
  private readonly dependencies: AgentFileDependencies;

  public constructor(dependencies: AgentFileDependencies) {
    this.dependencies = dependencies;
  }

  /** Dispatches recognized file operations and returns null for the other operation families. */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | null> {
    const isRead = AGENT_FILE_READ_OPERATIONS.some(
      (entry) => entry === operation,
    );
    const isWrite = AGENT_FILE_WRITE_OPERATIONS.some(
      (entry) => entry === operation,
    );
    if ((!isRead && !isWrite) || typeof operation !== "string") return null;
    if (typeof input !== "object" || input === null || Array.isArray(input))
      throw new AgentOperationError("INVALID_REQUEST");
    const parameters = Object.fromEntries(Object.entries(input));
    const tool = Object.keys(REPOSITORY_READ_SCHEMAS).find(
      (name): name is keyof typeof REPOSITORY_READ_SCHEMAS =>
        name === operation.replace(".", "_"),
    );
    if (tool) return this.repositoryRead(identity.userId, tool, parameters);
    const storageOperation = operation.slice("storage.".length);
    const parsed = readMcpStorageInput(parameters);
    if (!parsed) throw new AgentOperationError("INVALID_REQUEST");
    const api = new McpStorageService(
      this.dependencies.files.forAccount(identity.userId),
    );
    const supported = STORAGE_OPERATIONS.find(
      (entry) => entry === storageOperation,
    );
    if (!supported) throw new AgentOperationError("INVALID_REQUEST");
    const perform = async (): Promise<StorageResult<object>> =>
      api.run(supported, {
        input: parsed,
        userId: identity.userId,
        bytes: decodeStorageContent(parameters),
      });
    if (!isWrite) return storageResult(await perform());
    const context = await this.dependencies.access.context(identity.userId);
    if (
      !context ||
      !(await this.dependencies.access.allows(context, supported, parsed))
    )
      throw new AgentOperationError("FORBIDDEN");
    return this.write(identity.userId, operation, parameters, perform);
  }

  private async repositoryRead(
    userId: string,
    tool: RepositoryReadTool,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<PagesAgentReadResponse> {
    try {
      return {
        apiVersion: "1",
        result: {
          repository: await this.dependencies.repositories.run(
            userId,
            tool,
            parameters,
          ),
        },
      };
    } catch (error: unknown) {
      if (error instanceof RepositoryReadError) {
        if (error.code === "FORBIDDEN")
          throw new AgentOperationError("FORBIDDEN");
        if (error.code === "TOO_LARGE")
          throw new AgentOperationError("PAYLOAD_TOO_LARGE");
        throw new AgentOperationError("INVALID_REQUEST");
      }
      throw error;
    }
  }

  private async write(
    userId: string,
    operation: string,
    input: Readonly<Record<string, unknown>>,
    perform: () => Promise<StorageResult<object>>,
  ): Promise<PagesAgentReadResponse> {
    const operationId = input.operationId;
    if (typeof operationId !== "string" || !/^[\w-]{1,200}$/u.test(operationId))
      throw new AgentOperationError("INVALID_REQUEST");
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify(
          Object.entries(input).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      )
      .digest("hex");
    const receipt = await this.dependencies.receipts.claim(
      userId,
      operationId,
      { fingerprint, operation },
    );
    if (receipt) {
      if (
        receipt.fingerprint !== fingerprint ||
        receipt.operation !== operation ||
        receipt.resultJson === "null"
      )
        throw new AgentOperationError("CONFLICT");
      const parsed: unknown = JSON.parse(receipt.resultJson);
      if (typeof parsed !== "object" || parsed === null)
        throw new AgentOperationError("CONFLICT");
      return { apiVersion: "1", result: { storage: parsed } };
    }
    const result = await perform();
    await this.dependencies.receipts.finish(
      userId,
      operationId,
      JSON.stringify(result),
    );
    return storageResult(result);
  }
}
