import { createHash } from "node:crypto";

import { ServerCache } from "@/backend/cache/ServerCache";
import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
  ProjectRunsActiveError,
} from "@/backend/error/ProjectErrors";
import {
  finishProjectDeletion,
  ProjectDeletionService,
} from "@/backend/service/project/ProjectDeletionService";
import { logCaughtError } from "@/backend/logging/Logger";

import { requireAgentAdministratorActor } from "./AgentAdministratorAccess";
import { requireProjectDeletionConfirmation } from "./AgentConfirmation";
import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";
import {
  projectDeletionResult,
  readStoredProjectDeletion,
} from "./AgentProjectDeletionResult";
import { translateAgentTicketError } from "./AgentTicketErrors";
import { agentTransactionScope } from "./AgentTransactionScope";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { ProjectDeletionFiles } from "@/backend/database/repositories/project/ProjectDeletionFiles";
import type { ProjectDeletionEffects } from "@/backend/service/project/ProjectDeletionService";
import type {
  AgentAdminChanged,
  AgentAdminWriteResponse,
} from "@/definition/AgentAdministration";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { User } from "@/definition/User";

const DELETE_OPERATION = "admin.projects.delete";
const SCOPE_OPERATION = "admin.projects.deletionScope";

/** Server-owned dependencies; no actor or policy arrives through the parameters. */
export interface AgentProjectDeletionDependencies {
  readonly database: Pick<Database, "transaction">;
  /** The shared cache, invalidated once a deletion committed. */
  readonly cache: ServerCache;
  /** Stops plan runs and removes files; absent when the process owns neither. */
  readonly effects: ProjectDeletionEffects | null;
}

/** The validated parameters of one deletion call. */
interface DeleteRequest {
  readonly confirmation: unknown;
  readonly operationId: string;
  readonly projectId: string;
}

/** The administrator behind a call, and the stored result when the operation ID was used before. */
interface CheckedRequest {
  readonly actor: User;
  readonly stored: AgentAdminChanged | null;
}

/** What the deleting transaction returned; no files when an earlier call with the same ID did the work. */
interface RemovedProject {
  readonly files: ProjectDeletionFiles | null;
  readonly result: AgentAdminChanged;
}

/** Binds an operation ID to the project it was first used for; either confirmation word replays alike. */
function fingerprint(projectId: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ channel: "mcp", projectId }))
    .digest("hex");
}

function translate(error: unknown): unknown {
  if (error instanceof ProjectManagementDeniedError)
    return new AgentOperationError("FORBIDDEN");
  if (
    error instanceof ProjectNotFoundError ||
    error instanceof ProjectAccessDeniedError
  )
    return new AgentOperationError("NOT_FOUND");
  // Nothing was deleted; the call can be repeated once the runs have closed.
  if (error instanceof ProjectRunsActiveError)
    return new AgentOperationError("CONFLICT");
  return translateAgentTicketError(error);
}

function readDeleteRequest(input: unknown): DeleteRequest {
  const parameters = readParameterRecord(input ?? {});
  requireParameterKeys(
    parameters,
    ["operationId", "projectId"],
    ["confirmation"],
  );
  return {
    confirmation: parameters.confirmation,
    operationId: readIdentifier(parameters.operationId),
    projectId: readIdentifier(parameters.projectId),
  };
}

/**
 * Reads and deletes projects for personal administrators over MCP.
 *
 * @remarks
 * The deletion is the one in {@link ProjectDeletionService}, which the
 * interface uses too. This class adds what MCP needs around it: the exact
 * parameters, the confirmation word, the replay record of the operation ID
 * and the audit entry, all committed with the deletion or not at all. The
 * chat agent never gets this service wired in.
 */
export class AgentProjectDeletionService {
  private readonly dependencies: AgentProjectDeletionDependencies;

  public constructor(dependencies: AgentProjectDeletionDependencies) {
    this.dependencies = dependencies;
  }

  /** Handles the two operations, or returns `null` when the name is none of them. */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | AgentAdminWriteResponse | null> {
    try {
      if (operation === SCOPE_OPERATION)
        return await this.read(identity, input);
      if (operation === DELETE_OPERATION)
        return await this.delete(identity, readDeleteRequest(input));
      return null;
    } catch (error: unknown) {
      logCaughtError("AgentProjectDeletionService", error);

      throw translate(error);
    }
  }

  private async read(
    identity: AgentIdentity,
    input: unknown,
  ): Promise<PagesAgentReadResponse> {
    const parameters = readParameterRecord(input ?? {});
    requireParameterKeys(parameters, ["projectId"]);
    const projectId = readIdentifier(parameters.projectId);
    const details = await this.dependencies.database.transaction(
      async (transaction) => {
        const { actor } = await requireAgentAdministratorActor(
          transaction,
          identity.userId,
          "mcp",
        );
        return this.service(transaction).describe(actor, projectId);
      },
    );
    return { apiVersion: "1", result: details.scope };
  }

  private async delete(
    identity: AgentIdentity,
    request: DeleteRequest,
  ): Promise<AgentAdminWriteResponse> {
    // Nothing changes before the call is authorized, confirmed and not already done.
    const earlier = await this.dependencies.database.transaction(
      async (transaction) => this.prepare(transaction, identity, request),
    );
    if (earlier) return { apiVersion: "1", result: earlier };
    // Running plans write through the shared connection, so they stop outside the transaction.
    await this.dependencies.effects?.stopRuns(request.projectId);
    const removed = await this.dependencies.database.transaction(
      async (transaction) => this.remove(transaction, identity, request),
    );
    if (removed.files)
      await finishProjectDeletion(
        this.dependencies.cache,
        this.dependencies.effects,
        request.projectId,
        removed.files,
      );
    return { apiVersion: "1", result: removed.result };
  }

  private async prepare(
    transaction: DatabaseTransaction,
    identity: AgentIdentity,
    request: DeleteRequest,
  ): Promise<AgentAdminChanged | null> {
    const { actor, stored } = await this.check(transaction, identity, request);
    if (stored) return stored;
    await this.service(transaction).authorize(actor, request.projectId);
    return null;
  }

  private async remove(
    transaction: DatabaseTransaction,
    identity: AgentIdentity,
    request: DeleteRequest,
  ): Promise<RemovedProject> {
    const { actor, stored } = await this.check(transaction, identity, request);
    // A call with the same ID that committed meanwhile already did the work.
    if (stored) return { files: null, result: stored };
    const outcome = await this.service(transaction).delete(
      actor,
      request.projectId,
    );
    const result = projectDeletionResult(outcome);
    await new AdministrationActivityRepository(transaction).insert({
      actorId: actor.id,
      operation: DELETE_OPERATION,
      source: "mcp",
      result,
    });
    await new AgentOperationKeyRepository(transaction).insert(
      actor.id,
      request.operationId,
      {
        operation: DELETE_OPERATION,
        fingerprint: fingerprint(request.projectId),
        resultJson: JSON.stringify(result),
      },
    );
    return { files: outcome.files, result };
  }

  /** Requires the administrator and the confirmation anew, and finds an earlier call with this ID. */
  private async check(
    transaction: DatabaseTransaction,
    identity: AgentIdentity,
    request: DeleteRequest,
  ): Promise<CheckedRequest> {
    const { actor } = await requireAgentAdministratorActor(
      transaction,
      identity.userId,
      "mcp",
    );
    requireProjectDeletionConfirmation(request.confirmation);
    const previous = await new AgentOperationKeyRepository(transaction).find(
      actor.id,
      request.operationId,
    );
    return { actor, stored: previous ? this.replay(previous, request) : null };
  }

  private replay(
    previous: StoredAgentOperation,
    request: DeleteRequest,
  ): AgentAdminChanged {
    if (
      previous.operation !== DELETE_OPERATION ||
      previous.fingerprint !== fingerprint(request.projectId)
    )
      throw new AgentOperationError("CONFLICT");
    return readStoredProjectDeletion(previous.resultJson);
  }

  /** Builds the shared deletion service on the scope of one transaction. */
  private service(transaction: DatabaseTransaction): ProjectDeletionService {
    return new ProjectDeletionService(
      new ProjectRepository(agentTransactionScope(transaction), "mcp"),
      ServerCache.disabled(),
      "mcp",
    );
  }
}
