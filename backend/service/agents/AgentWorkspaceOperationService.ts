import { createHash } from "node:crypto";

import { readWorkspaceInput } from "@/backend/agents/AgentWorkspaceInput";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  AGENT_WORKSPACE_READ_OPERATIONS,
  AGENT_WORKSPACE_WRITE_OPERATIONS,
} from "@/definition/AgentWorkspaceOperations";

import { pageAgentEntries } from "./AgentCursor";
import { translateWorkspaceError } from "./AgentWorkspaceOperationErrors";
import {
  readWorkspaceListRequest,
  readWorkspaceReadRequest,
  readWorkspaceWriteRequest,
} from "./AgentWorkspaceOperationInput";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { WorkspaceJournal } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  AgentWorkspace,
  AgentWorkspaceView,
} from "@/definition/AgentWorkspace";
import type {
  AgentWorkspaceChanged,
  AgentWorkspaceEntry,
  AgentWorkspaceReadOperation,
  AgentWorkspaceUnavailableReason,
  AgentWorkspaceWriteOperation,
} from "@/definition/AgentWorkspaceOperations";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";
import type {
  WorkspaceUpdateRequest,
  WorkspaceWriteRequest,
} from "./AgentWorkspaceOperationInput";

/** The registry and the database its operation results are stored in. */
export interface AgentWorkspaceOperationDependencies {
  readonly database: Pick<Database, "transaction">;
  /** The registry as the MCP channel sees it: a personal administrator counts as one. */
  readonly workspaces: AgentWorkspaceService;
}

const UNAVAILABLE_REASONS: Readonly<
  Partial<Record<AgentErrorCode, AgentWorkspaceUnavailableReason>>
> = {
  workspace_access_denied: "project_unavailable",
  workspace_project_unsupported: "github_link_missing",
  workspace_path_invalid: "path_invalid",
  workspace_path_unavailable: "path_unavailable",
  workspace_path_denied: "path_unavailable",
  workspace_roots_missing: "path_unavailable",
  workspace_path_outside_roots: "path_not_allowed",
  workspace_path_contains_instance: "path_not_allowed",
  workspace_path_changed: "path_changed",
};

function isReadOperation(value: unknown): value is AgentWorkspaceReadOperation {
  return AGENT_WORKSPACE_READ_OPERATIONS.some((name) => name === value);
}

function isWriteOperation(
  value: unknown,
): value is AgentWorkspaceWriteOperation {
  return AGENT_WORKSPACE_WRITE_OPERATIONS.some((name) => name === value);
}

function toEntry(view: AgentWorkspaceView): AgentWorkspaceEntry {
  return {
    id: view.id,
    name: view.name,
    path: view.path,
    projectId: view.projectId,
    projectName: view.projectName,
    github: view.github,
    revision: view.revision,
    isUsable: view.isUsable,
    unavailableReason:
      view.reason === null
        ? null
        : (UNAVAILABLE_REASONS[view.reason] ?? "path_unavailable"),
    canManage: view.canManage,
  };
}

function readStoredResult(json: string): AgentWorkspaceChanged {
  const stored: unknown = JSON.parse(json);
  if (
    typeof stored !== "object" ||
    stored === null ||
    !("id" in stored) ||
    typeof stored.id !== "string" ||
    !("projectId" in stored) ||
    typeof stored.projectId !== "string" ||
    !("changed" in stored) ||
    typeof stored.changed !== "boolean" ||
    !("revision" in stored) ||
    (stored.revision !== null && typeof stored.revision !== "number") ||
    !("removed" in stored) ||
    typeof stored.removed !== "boolean"
  )
    throw new AgentOperationError("CONFLICT");
  return {
    id: stored.id,
    projectId: stored.projectId,
    changed: stored.changed,
    revision: stored.revision,
    removed: stored.removed,
  };
}

/** Binds an operation ID to the exact request it was first used with. */
function fingerprintOf(request: WorkspaceWriteRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

/** An earlier call with this operation ID committed first; its result is the answer. */
class StoredOperationFound extends Error {
  public readonly stored: StoredAgentOperation;

  public constructor(stored: StoredAgentOperation) {
    super("The operation was completed before.");
    this.stored = stored;
  }
}

/** Stores the result of one call under its operation ID, in the commit of the change itself. */
class OperationRecorder {
  private readonly userId: string;
  private readonly request: WorkspaceWriteRequest;
  private readonly fingerprint: string;
  private readonly results: AgentWorkspaceChanged[] = [];

  public constructor(userId: string, request: WorkspaceWriteRequest) {
    this.userId = userId;
    this.request = request;
    this.fingerprint = fingerprintOf(request);
  }

  /** The work that commits with a save or a removal of the registry. */
  public asJournal(): WorkspaceJournal {
    return (transaction, workspace) => this.record(transaction, workspace);
  }

  /** The result of the change that committed. */
  public get result(): AgentWorkspaceChanged {
    return this.results[0];
  }

  /** Stores a result, or reports that the operation ID was used before. */
  public async store(
    transaction: DatabaseTransaction,
    result: AgentWorkspaceChanged,
  ): Promise<void> {
    const keys = new AgentOperationKeyRepository(transaction);
    const previous = await keys.find(this.userId, this.request.operationId);
    if (previous) throw new StoredOperationFound(previous);
    await keys.insert(this.userId, this.request.operationId, {
      operation: this.request.operation,
      fingerprint: this.fingerprint,
      resultJson: JSON.stringify(result),
    });
    this.results.push(result);
  }

  /** Stores the result of a change whose registry record is `workspace`. */
  private async record(
    transaction: DatabaseTransaction,
    workspace: AgentWorkspace,
  ): Promise<void> {
    const isRemoval = this.request.operation === "workspaces.remove";
    await this.store(transaction, {
      id: workspace.id,
      projectId: workspace.projectId,
      changed: true,
      revision: isRemoval ? null : workspace.revision,
      removed: isRemoval,
    });
  }
}

/**
 * Lists and manages agent workspaces for connected MCP clients.
 *
 * @remarks
 * Every call runs under the rules of the interface: the registry decides who
 * may see a workspace and who may register one, so no right of the adapter
 * exists. A write is repeatable by its operation ID and refuses a stale
 * `expectedRevision`. Only registry metadata changes; no directory is read,
 * written or deleted.
 */
export class AgentWorkspaceOperationService {
  private readonly dependencies: AgentWorkspaceOperationDependencies;

  public constructor(dependencies: AgentWorkspaceOperationDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Handles a workspace operation, returning `null` when another service owns the name.
   *
   * @param identity - The verified identity of the call.
   * @param operation - The operation name as received.
   * @param input - The raw parameters.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `NOT_FOUND`, `FORBIDDEN` or `CONFLICT`.
   */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | PagesAgentWriteResponse | null> {
    try {
      if (isReadOperation(operation))
        return await this.read(identity.userId, operation, input ?? {});
      if (isWriteOperation(operation))
        return await this.write(identity.userId, operation, input ?? {});
      return null;
    } catch (error: unknown) {
      throw translateWorkspaceError(error);
    }
  }

  private async read(
    userId: string,
    operation: AgentWorkspaceReadOperation,
    input: unknown,
  ): Promise<PagesAgentReadResponse> {
    const { workspaces } = this.dependencies;
    if (operation === "workspaces.read") {
      const view = await workspaces.read(
        userId,
        readWorkspaceReadRequest(input),
      );
      return { apiVersion: "1", result: { workspace: toEntry(view) } };
    }
    const request = readWorkspaceListRequest(input);
    const views = await workspaces.list(userId, request.projectId);
    const page = pageAgentEntries(views.map(toEntry), {
      cursor: request.cursor,
      limit: request.limit,
      context: JSON.stringify([userId, operation, request.projectId]),
      // The registry already orders by name, which is what a client expects to read.
      preserveOrder: true,
    });
    return {
      apiVersion: "1",
      result: {
        workspaces: page.entries,
        total: page.total,
        nextCursor: page.nextCursor,
      },
    };
  }

  private async write(
    userId: string,
    operation: AgentWorkspaceWriteOperation,
    input: unknown,
  ): Promise<PagesAgentWriteResponse> {
    const request = readWorkspaceWriteRequest(operation, input);
    const stored = await this.lookup(userId, request.operationId);
    if (stored) return this.replay(userId, request, stored);
    const recorder = new OperationRecorder(userId, request);
    try {
      await this.apply(userId, request, recorder);
    } catch (error: unknown) {
      // A parallel call with the same operation ID may have committed between
      // the lookup and the write; whatever refused this one, that call's
      // result is the answer.
      const completed =
        error instanceof StoredOperationFound
          ? error.stored
          : await this.lookup(userId, request.operationId);
      if (completed) return this.replay(userId, request, completed);
      throw error;
    }
    return { apiVersion: "1", result: recorder.result };
  }

  private async lookup(
    userId: string,
    operationId: string,
  ): Promise<StoredAgentOperation | null> {
    return this.dependencies.database.transaction((transaction) =>
      new AgentOperationKeyRepository(transaction).find(userId, operationId),
    );
  }

  /** Shows a stored result again only while the person may still manage its project. */
  private async replay(
    userId: string,
    request: WorkspaceWriteRequest,
    stored: StoredAgentOperation,
  ): Promise<PagesAgentWriteResponse> {
    if (
      stored.operation !== request.operation ||
      stored.fingerprint !== fingerprintOf(request)
    )
      throw new AgentOperationError("CONFLICT");
    const result = readStoredResult(stored.resultJson);
    await this.dependencies.workspaces.requireManagement(
      userId,
      result.projectId,
    );
    return { apiVersion: "1", result };
  }

  private async apply(
    userId: string,
    request: WorkspaceWriteRequest,
    recorder: OperationRecorder,
  ): Promise<void> {
    const { workspaces } = this.dependencies;
    if (request.operation === "workspaces.create") {
      const input = readWorkspaceInput({
        name: request.name,
        path: request.path,
        projectId: request.projectId,
      });
      await workspaces.save(userId, null, input, recorder.asJournal());
      return;
    }
    const current = await this.requireCurrent(userId, request);
    if (request.operation === "workspaces.remove") {
      await workspaces.remove(
        userId,
        current.id,
        request.expectedRevision,
        recorder.asJournal(),
      );
      return;
    }
    await this.update(userId, request, current, recorder);
  }

  /** The workspace as the client last read it: visible, manageable and not changed since. */
  private async requireCurrent(
    userId: string,
    request: { workspaceId: string; expectedRevision: number },
  ): Promise<AgentWorkspaceView> {
    const current = await this.dependencies.workspaces.read(
      userId,
      request.workspaceId,
    );
    if (!current.canManage) throw new AgentError("workspace_management_denied");
    if (current.revision !== request.expectedRevision)
      throw new AgentOperationError("CONFLICT", {
        currentRevision: current.revision,
      });
    return current;
  }

  private async update(
    userId: string,
    request: WorkspaceUpdateRequest,
    current: AgentWorkspaceView,
    recorder: OperationRecorder,
  ): Promise<void> {
    const proposed = readWorkspaceInput({
      name: current.name,
      path: current.path,
      projectId: current.projectId,
      ...request.changes,
    });
    const isUnchanged =
      proposed.name === current.name &&
      proposed.path === current.path &&
      proposed.projectId === current.projectId;
    if (isUnchanged) {
      await this.dependencies.database.transaction((transaction) =>
        recorder.store(transaction, {
          id: current.id,
          projectId: current.projectId,
          changed: false,
          revision: current.revision,
          removed: false,
        }),
      );
      return;
    }
    await this.dependencies.workspaces.save(
      userId,
      current.id,
      { ...proposed, revision: current.revision },
      recorder.asJournal(),
    );
  }
}
