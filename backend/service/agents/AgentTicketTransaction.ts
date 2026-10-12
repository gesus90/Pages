import { createHash, randomUUID } from "node:crypto";

import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { CAPABILITY } from "@/definition/Authorization";

import { createAgentTaskContext } from "./AgentTaskAccess";
import { agentTransactionScope } from "./AgentTransactionScope";
import { translateAgentTicketError } from "./AgentTicketErrors";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";
import type { AgentTaskContext } from "./AgentTaskAccess";

/** What one call changed, to be announced only after its transaction has committed. */
export interface AgentTicketOutcome<Result> {
  readonly result: Result;
  /** The ticket to hand to the GitHub publisher; `null` when GitHub does not follow the change. */
  readonly published: WorkItemDetail | null;
  /** The event to emit; `null` when nothing was written. */
  readonly event: PagesEvent | null;
}

/** An outcome together with the account it was produced for. */
export interface AgentTicketCompleted<
  Result,
> extends AgentTicketOutcome<Result> {
  readonly actor: User;
}

/** One idempotent, atomic ticket or milestone operation. */
export interface AgentTicketRun<Result> {
  readonly userId: string;
  readonly operation: string;
  /** The exact parameters; the operation ID binds to them. */
  readonly request: { readonly operationId: string };
  /** Whether the global ticket write right is required before anything is looked at. */
  readonly needsWriteRight: boolean;
  /** Shows a stored result again only while its object is still visible. */
  readonly revisit: (
    context: AgentTaskContext,
    stored: Result,
  ) => Promise<void>;
  readonly work: (
    context: AgentTaskContext,
  ) => Promise<AgentTicketOutcome<Result>>;
}

/** Binds an operation ID to the exact parameters it was first used with. */
function fingerprint(request: object): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

/**
 * Runs ticket and milestone operations in one transaction with the stored
 * result of their operation ID.
 *
 * @remarks
 * Account, rights and visibility are resolved anew inside the transaction. The
 * result is stored in the same commit as the change, so a lost response is
 * recovered by repeating the call and never creates a second object. A
 * refused call writes nothing and stores nothing.
 */
export class AgentTicketTransaction {
  private readonly database: Database;
  private readonly channel: AgentChannel;

  public constructor(database: Database, channel: AgentChannel = "mcp") {
    this.database = database;
    this.channel = channel;
  }

  /**
   * Runs one operation for the owner of a verified credential.
   *
   * @param run - The operation, its parameters and the work to do.
   * @returns The stored or new outcome and the account.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `FORBIDDEN`, `NOT_FOUND` or `CONFLICT`.
   */
  public async run<Result>(
    run: AgentTicketRun<Result>,
  ): Promise<AgentTicketCompleted<Result>> {
    try {
      return await this.database.transaction((transaction) =>
        this.execute(transaction, run),
      );
    } catch (error: unknown) {
      throw translateAgentTicketError(error);
    }
  }

  /**
   * Runs one operation in a transaction the caller already holds, so the
   * object, its result and the caller's own records commit together.
   *
   * @param transaction - The open transaction of the caller.
   * @param run - The operation, its parameters and the work to do.
   * @returns The stored or new outcome and the account; nothing is announced yet.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `FORBIDDEN`, `NOT_FOUND` or `CONFLICT`.
   */
  public async runWithin<Result>(
    transaction: DatabaseTransaction,
    run: AgentTicketRun<Result>,
  ): Promise<AgentTicketCompleted<Result>> {
    try {
      return await this.execute(transaction, run);
    } catch (error: unknown) {
      throw translateAgentTicketError(error);
    }
  }

  private async recordActivity(
    context: AgentTaskContext,
    operation: string,
    event: PagesEvent,
  ): Promise<void> {
    if (
      !event.type.startsWith("ticket.") &&
      !event.type.startsWith("milestone.")
    )
      return;
    const tasks = new TaskRepository(context.database);
    const ticket = event.type.startsWith("ticket.")
      ? await tasks.findById(event.id)
      : null;
    const milestone = event.type.startsWith("milestone.")
      ? await tasks.findMilestoneById(event.id)
      : null;
    const projectId = ticket?.projectId ?? milestone?.projectId;
    if (!projectId) return;
    await new ProjectRepository(
      context.database,
      agentChannelPolicy(this.channel).source,
    ).insertActivity({
      id: randomUUID(),
      projectId,
      userId: context.actor.id,
      category: ticket ? "tasks" : "planning",
      action: operation,
      message:
        this.channel === "chat" ? "Change via chat agent." : "Change via MCP.",
      ...(ticket ? { workItemId: ticket.id } : {}),
    });
  }

  private async execute<Result>(
    transaction: DatabaseTransaction,
    run: AgentTicketRun<Result>,
  ): Promise<AgentTicketCompleted<Result>> {
    const scope = agentTransactionScope(transaction);
    const actor = await new UserRepository(scope).findById(run.userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new McpAuthorizationError("invalid_token", 401);
    const context = createAgentTaskContext(scope, actor, this.channel);
    // The write right is global, so refusing first reveals nothing about any object.
    if (
      run.needsWriteRight &&
      !(await context.permissions.hasCapability(actor, CAPABILITY.WRITE))
    )
      throw new AgentOperationError("FORBIDDEN");
    const operations = new AgentOperationKeyRepository(transaction);
    const hash = fingerprint(run.request);
    const previous = await operations.find(run.userId, run.request.operationId);
    if (previous) {
      if (previous.operation !== run.operation || previous.fingerprint !== hash)
        throw new AgentOperationError("CONFLICT");
      // This JSON is written only below, with the public result schema, in the same commit.
      const stored = JSON.parse(previous.resultJson) as Result;
      await run.revisit(context, stored);
      return { actor, result: stored, published: null, event: null };
    }
    const outcome = await run.work(context);
    if (outcome.event !== null)
      await this.recordActivity(context, run.operation, outcome.event);
    await operations.insert(run.userId, run.request.operationId, {
      operation: run.operation,
      fingerprint: hash,
      resultJson: JSON.stringify(outcome.result),
    });
    return { ...outcome, actor };
  }
}
