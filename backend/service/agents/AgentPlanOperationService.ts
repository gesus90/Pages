import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AGENT_PLAN_COMMAND_OPERATIONS } from "@/definition/AgentPlanOperations";
import {
  AGENT_PLAN_READ_OPERATIONS,
  AGENT_PLAN_WRITE_OPERATIONS,
} from "@/definition/AgentPlanOperations";
import { logCaughtError } from "@/backend/logging/Logger";

import { AgentPlanCommandOperations } from "./AgentPlanCommandOperations";
import { readPlanResources } from "./AgentPlanResourceReads";
import { translatePlanError } from "./AgentPlanOperationErrors";
import { AgentPlanReadOperations } from "./AgentPlanReadOperations";
import { AgentPlanWriteOperations } from "./AgentPlanWriteOperations";

import type { AgentPlanResourceServices } from "./AgentPlanResourceReads";
import type { Database } from "@/backend/database/Database";
import type {
  AgentPlanReadOperation,
  AgentPlanWriteOperation,
} from "@/definition/AgentPlanOperations";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { AgentPlanReads } from "./AgentPlanReadOperations";
import type { AgentPlanWriteDependencies } from "./AgentPlanWriteOperations";

/** The plan service and the database the results of plan changes are stored in. */
export interface AgentPlanOperationDependencies {
  readonly database: Pick<Database, "transaction">;
  readonly resources?: AgentPlanResourceServices;
  readonly plans: AgentPlanReads & AgentPlanWriteDependencies["plans"];
}

function isReadOperation(value: unknown): value is AgentPlanReadOperation {
  return AGENT_PLAN_READ_OPERATIONS.some((name) => name === value);
}

function isWriteOperation(value: unknown): value is AgentPlanWriteOperation {
  return AGENT_PLAN_WRITE_OPERATIONS.some((name) => name === value);
}

/**
 * Lists, reads, creates and changes agent plans, and reads runs and their reports,
 * for MCP clients and the chat.
 *
 * @remarks
 * The adapter holds no right of its own: every call runs through the plan
 * service with the rules of the plan page. Plans are visible through their
 * workspace and share, the owner and the team of a plan change it, and runs and their reports
 * belong to the person who started them.
 */
export class AgentPlanOperationService {
  private readonly resources: AgentPlanResourceServices | undefined;
  private readonly commands: AgentPlanCommandOperations | null;
  private readonly reads: AgentPlanReadOperations;
  private readonly writes: AgentPlanWriteOperations;

  public constructor(dependencies: AgentPlanOperationDependencies) {
    this.resources = dependencies.resources;
    this.commands = dependencies.resources
      ? new AgentPlanCommandOperations({
          database: dependencies.database,
          ...dependencies.resources,
        })
      : null;
    this.reads = new AgentPlanReadOperations(dependencies.plans);
    this.writes = new AgentPlanWriteOperations({
      ...dependencies,
      templates: dependencies.resources?.templates,
    });
  }

  /**
   * Handles a plan operation, returning `null` when another service owns the name.
   *
   * @param identity - The verified identity of the call.
   * @param operation - The operation name as received.
   * @param input - The raw parameters.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `NOT_FOUND`, `FORBIDDEN`,
   * `CONFLICT` or `PAYLOAD_TOO_LARGE`.
   */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | PagesAgentWriteResponse | null> {
    try {
      const command = AGENT_PLAN_COMMAND_OPERATIONS.find(
        (name) => name === operation,
      );
      if (command && identity.run) throw new AgentOperationError("FORBIDDEN");
      if (command && this.commands)
        return {
          apiVersion: "1",
          result: await this.commands.write(
            identity.userId,
            command,
            input ?? {},
          ),
        };
      if (this.resources && typeof operation === "string") {
        const result = await readPlanResources(
          this.resources,
          identity.userId,
          operation,
          input ?? {},
        );
        if (result) {
          return resourceResponse(result);
        }
      }
      if (isReadOperation(operation))
        return await this.reads.read(identity.userId, operation, input ?? {});
      if (isWriteOperation(operation))
        return await this.writes.write(identity.userId, operation, input ?? {});
      return null;
    } catch (error: unknown) {
      logCaughtError("AgentPlanOperationService", error);

      throw translatePlanError(error);
    }
  }
}

function resourceResponse(
  result: PagesAgentReadResponse["result"],
): PagesAgentReadResponse {
  const response: PagesAgentReadResponse = { apiVersion: "1", result };
  if (
    Buffer.byteLength(JSON.stringify(response)) >
    PAGES_AGENT_LIMITS.responseBytes
  )
    throw new AgentOperationError("PAYLOAD_TOO_LARGE");
  return response;
}
