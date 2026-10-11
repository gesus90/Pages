import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { WORKFLOW_STATUS_KEY } from "@/definition/Task";

import {
  isAgentTicketFieldOperation,
  readAgentTicketCreate,
  readAgentTicketFieldChange,
} from "./AgentTicketValidation";

import type {
  AgentTicketChanged,
  AgentTicketCreateInput,
  AgentTicketCreated,
  AgentTicketFieldInput,
  AgentTicketOperation,
  AgentTicketParentChange,
  AgentTicketReference,
  AgentTicketTarget,
} from "@/definition/AgentTickets";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { WorkflowStatus, WorkItemDetail } from "@/definition/Task";
import type { AgentTaskContext } from "./AgentTaskAccess";
import type { AgentTicketAnnouncer } from "./AgentTicketAnnouncer";
import type {
  AgentTicketCompleted,
  AgentTicketOutcome,
  AgentTicketRun,
  AgentTicketTransaction,
} from "./AgentTicketTransaction";

/** The server-owned collaborators of ticket writes. */
export interface AgentTicketServiceDependencies {
  readonly transaction: AgentTicketTransaction;
  readonly announcer: AgentTicketAnnouncer;
}

function ticketLink(key: string): string {
  return `/tasks/${key}`;
}

/** Finds the status a new ticket of the project starts in: backlog, else the first open one. */
function findDefaultStatusId(
  statuses: readonly WorkflowStatus[],
  projectId: string,
): string {
  const applicable = statuses.filter(
    (status) => status.projectId === null || status.projectId === projectId,
  );
  const status =
    applicable.find(({ key }) => key === WORKFLOW_STATUS_KEY.BACKLOG) ??
    applicable.find(({ isDone }) => !isDone) ??
    applicable[0];

  return status?.id ?? "";
}

/** A visible ticket by identifier or key; a hidden one is reported as missing. */
async function requireTicket(
  context: AgentTaskContext,
  reference: AgentTicketReference,
): Promise<WorkItemDetail> {
  return "id" in reference
    ? context.tasks.getById(context.actor, reference.id)
    : context.tasks.getByKey(context.actor, reference.key);
}

/** Tells whether a parent reference names the parent the ticket has as the account sees it. */
function isParent(
  ticket: WorkItemDetail,
  reference: AgentTicketReference | null,
): boolean {
  if (reference === null) return ticket.parentId === null;
  return "id" in reference
    ? ticket.parentId === reference.id
    : ticket.parentKey?.toUpperCase() === reference.key;
}

/** Whether the field the call names holds another value afterwards. */
function hasChangedField(
  field: AgentTicketFieldInput["field"],
  before: WorkItemDetail,
  after: WorkItemDetail,
): boolean {
  return {
    description: before.description !== after.description,
    parent: before.parentId !== after.parentId,
    status: before.statusId !== after.statusId,
    title: before.title !== after.title,
  }[field];
}

/** Creates tickets locally and changes one of their fields at a time for an agent. */
export class AgentTicketService {
  private readonly dependencies: AgentTicketServiceDependencies;

  public constructor(dependencies: AgentTicketServiceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Runs one ticket write for the owner of a verified credential.
   *
   * @param identity - The verified owner of the operation.
   * @param operation - `ticket.create` or one of the `ticket.set…` operations.
   * @param parameters - The raw operation parameters.
   * @returns The stored result; a repeated operation ID returns it unchanged.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `FORBIDDEN`, `NOT_FOUND` or `CONFLICT`.
   *
   * @remarks
   * The write right is checked first, then a stored result, then visibility,
   * then the value the caller read. A hidden ticket is indistinguishable from a
   * missing one. Nothing is published before the commit; afterwards GitHub
   * follows the Pages setting of the project, never more and never less.
   */
  public async apply(
    identity: AgentIdentity,
    operation: AgentTicketOperation,
    parameters: unknown,
  ): Promise<PagesAgentWriteResponse> {
    const completed = isAgentTicketFieldOperation(operation)
      ? await this.runField(
          identity,
          operation,
          readAgentTicketFieldChange(operation, parameters),
        )
      : await this.runCreate(identity, readAgentTicketCreate(parameters));
    this.dependencies.announcer.announce(completed);
    return { apiVersion: "1", result: completed.result };
  }

  /**
   * Creates a ticket inside a transaction the caller holds.
   *
   * @param transaction - The open transaction of the caller.
   * @param userId - The verified owner of the operation.
   * @param request - The explicit create contract.
   * @returns The outcome, to be announced after the caller's commit.
   * @throws {AgentOperationError} `FORBIDDEN`, `NOT_FOUND`, `INVALID_REQUEST` or `CONFLICT`.
   */
  public async createWithin(
    transaction: DatabaseTransaction,
    userId: string,
    request: AgentTicketCreateInput,
  ): Promise<AgentTicketCompleted<AgentTicketCreated>> {
    return this.dependencies.transaction.runWithin(
      transaction,
      this.createRun(userId, request),
    );
  }

  private async runCreate(
    identity: AgentIdentity,
    request: AgentTicketCreateInput,
  ): Promise<AgentTicketCompleted<AgentTicketCreated>> {
    return this.dependencies.transaction.run(
      this.createRun(identity.userId, request),
    );
  }

  private createRun(
    userId: string,
    request: AgentTicketCreateInput,
  ): AgentTicketRun<AgentTicketCreated> {
    return {
      userId,
      operation: "ticket.create",
      request,
      needsWriteRight: true,
      revisit: async (context, stored) => {
        await context.tasks.getById(context.actor, stored.ticketId);
      },
      work: (context) => this.create(context, request),
    };
  }

  private async runField(
    identity: AgentIdentity,
    operation: AgentTicketOperation,
    request: AgentTicketFieldInput,
  ): Promise<AgentTicketCompleted<AgentTicketChanged>> {
    return this.dependencies.transaction.run<AgentTicketChanged>({
      userId: identity.userId,
      operation,
      request,
      needsWriteRight: true,
      revisit: async (context, stored) => {
        await context.tasks.getById(context.actor, stored.ticketId);
      },
      work: (context) => this.changeField(context, request),
    });
  }

  private async create(
    context: AgentTaskContext,
    request: AgentTicketCreateInput,
  ): Promise<AgentTicketOutcome<AgentTicketCreated>> {
    const { actor, tasks } = context;
    const statusId =
      request.statusId ??
      findDefaultStatusId(
        await tasks.findAllStatuses(actor),
        request.projectId,
      );
    const parent = request.parent
      ? await requireTicket(context, request.parent)
      : null;
    // No `skipGitHubSync`: the ticket follows the synchronization of its project.
    const created = await tasks.create(actor, {
      projectId: request.projectId,
      type: request.type,
      title: request.title,
      description: request.description,
      statusId,
      parentId: parent?.id ?? null,
      milestoneId: request.milestoneId,
    });
    return {
      result: {
        ticketId: created.id,
        key: created.key,
        link: ticketLink(created.key),
        statusId: created.statusId,
      },
      published: created,
      event: { type: "ticket.created", id: created.id },
    };
  }

  /** Reads the ticket, compares the value the caller read and changes only that field. */
  private async changeField(
    context: AgentTaskContext,
    request: AgentTicketFieldInput,
  ): Promise<AgentTicketOutcome<AgentTicketChanged>> {
    const existing = await requireTicket(context, request.ticket);
    const after = await this.write(context, existing, request);
    const hasChanged = hasChangedField(request.field, existing, after);
    return {
      result: {
        ticketId: existing.id,
        key: existing.key,
        link: ticketLink(existing.key),
        field: request.field,
        changed: hasChanged,
      },
      // GitHub does not learn of a new parent, like when the ticket page changes it.
      published: hasChanged && request.field !== "parent" ? after : null,
      event: hasChanged ? { type: "ticket.updated", id: existing.id } : null,
    };
  }

  private async write(
    context: AgentTaskContext,
    existing: WorkItemDetail,
    request: AgentTicketFieldInput,
  ): Promise<WorkItemDetail> {
    const { actor, tasks } = context;
    if (request.field === "parent")
      return this.writeParent(context, existing, request);
    if (request.field === "title")
      return tasks.updateTitle(actor, existing.id, {
        title: request.value,
        baseTitle: request.expected,
      });
    if (request.field === "description")
      return tasks.updateDescription(actor, existing.id, {
        description: request.value,
        baseDescription: request.expected,
      });
    return tasks.updateStatus(actor, existing.id, {
      statusId: request.value,
      baseStatusId: request.expected,
    });
  }

  private async writeParent(
    context: AgentTaskContext,
    existing: WorkItemDetail,
    request: AgentTicketTarget & AgentTicketParentChange,
  ): Promise<WorkItemDetail> {
    const { actor, tasks } = context;
    const parent = request.value
      ? await requireTicket(context, request.value)
      : null;
    // A parent the account cannot see counts as none: the value read and the value now must match.
    if (
      !isParent(existing, request.expected) &&
      existing.parentId !== (parent?.id ?? null)
    )
      throw new AgentOperationError("CONFLICT");
    return tasks.updateParent(actor, existing.id, {
      parentId: parent?.id ?? null,
      baseParentId: existing.parentId,
    });
  }
}
