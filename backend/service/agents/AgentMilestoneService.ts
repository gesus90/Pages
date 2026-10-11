import { AgentOperationError } from "@/backend/error/AgentOperationError";

import {
  isAgentMilestoneFieldOperation,
  readAgentMilestoneCreate,
  readAgentMilestoneDependencyAdd,
  readAgentMilestoneDependencyRemove,
  readAgentMilestoneFieldChange,
} from "./AgentTicketValidation";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  AgentMilestoneChanged,
  AgentMilestoneCreateInput,
  AgentMilestoneCreated,
  AgentMilestoneDependencyAddInput,
  AgentMilestoneDependencyChanged,
  AgentMilestoneFieldOperation,
  AgentMilestoneOperation,
} from "@/definition/AgentTickets";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { MilestoneDependency } from "@/definition/Task";
import type { AgentTaskContext } from "./AgentTaskAccess";
import type { AgentTicketAnnouncer } from "./AgentTicketAnnouncer";
import type {
  AgentTicketCompleted,
  AgentTicketRun,
  AgentTicketTransaction,
} from "./AgentTicketTransaction";

/** The server-owned collaborators of milestone writes. */
export interface AgentMilestoneServiceDependencies {
  readonly transaction: AgentTicketTransaction;
  readonly announcer: AgentTicketAnnouncer;
}

/** What every milestone result names, so a stored result is shown only while its project is visible. */
interface ProjectBound {
  readonly projectId: string;
}

async function revisitProject(
  context: AgentTaskContext,
  stored: ProjectBound,
): Promise<void> {
  await context.projects.getById(context.actor, stored.projectId);
}

function describeDependency(
  dependency: MilestoneDependency,
  isRemoved: boolean,
): AgentMilestoneDependencyChanged {
  return {
    dependencyId: dependency.id,
    projectId: dependency.projectId,
    sourceId: dependency.sourceId,
    targetId: dependency.targetId,
    linkType: dependency.linkType,
    removed: isRemoved,
  };
}

/** Creates milestones, changes one of their fields at a time and links them for an agent. */
export class AgentMilestoneService {
  private readonly dependencies: AgentMilestoneServiceDependencies;

  public constructor(dependencies: AgentMilestoneServiceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Runs one milestone write for the owner of a verified credential.
   *
   * @param identity - The verified owner of the operation.
   * @param operation - `milestone.create`, one of the `milestone.set…` operations or a dependency operation.
   * @param parameters - The raw operation parameters.
   * @returns The stored result; a repeated operation ID returns it unchanged.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `FORBIDDEN`, `NOT_FOUND` or `CONFLICT`.
   *
   * @remarks
   * Milestones follow the project management right, as on the milestone page:
   * an account that only writes tickets is refused with `FORBIDDEN`, and a
   * project the account cannot see is reported as missing.
   */
  public async apply(
    identity: AgentIdentity,
    operation: AgentMilestoneOperation,
    parameters: unknown,
  ): Promise<PagesAgentWriteResponse> {
    const completed = await this.run(identity, operation, parameters);
    this.dependencies.announcer.announce(completed);
    return { apiVersion: "1", result: completed.result };
  }

  /**
   * Creates a milestone inside a transaction the caller holds.
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
    request: AgentMilestoneCreateInput,
  ): Promise<AgentTicketCompleted<AgentMilestoneCreated>> {
    return this.dependencies.transaction.runWithin(
      transaction,
      this.createRun(userId, request),
    );
  }

  /**
   * Links two milestones inside a transaction the caller holds.
   *
   * @param transaction - The open transaction of the caller.
   * @param userId - The verified owner of the operation.
   * @param request - The explicit dependency contract.
   * @returns The outcome, to be announced after the caller's commit.
   * @throws {AgentOperationError} `FORBIDDEN`, `NOT_FOUND`, `INVALID_REQUEST` or `CONFLICT`.
   */
  public async linkWithin(
    transaction: DatabaseTransaction,
    userId: string,
    request: AgentMilestoneDependencyAddInput,
  ): Promise<AgentTicketCompleted<AgentMilestoneDependencyChanged>> {
    return this.dependencies.transaction.runWithin(
      transaction,
      this.linkRun(userId, request),
    );
  }

  private async run(
    identity: AgentIdentity,
    operation: AgentMilestoneOperation,
    parameters: unknown,
  ): Promise<
    AgentTicketCompleted<
      | AgentMilestoneCreated
      | AgentMilestoneChanged
      | AgentMilestoneDependencyChanged
    >
  > {
    if (isAgentMilestoneFieldOperation(operation))
      return this.change(identity, operation, parameters);
    if (operation === "milestone.dependency.add")
      return this.link(identity, parameters);
    if (operation === "milestone.dependency.remove")
      return this.unlink(identity, parameters);
    return this.create(identity, parameters);
  }

  private async create(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<AgentTicketCompleted<AgentMilestoneCreated>> {
    return this.dependencies.transaction.run(
      this.createRun(identity.userId, readAgentMilestoneCreate(parameters)),
    );
  }

  private createRun(
    userId: string,
    request: AgentMilestoneCreateInput,
  ): AgentTicketRun<AgentMilestoneCreated> {
    return {
      ...this.base(userId, "milestone.create", request),
      work: async ({ actor, tasks }) => {
        const created = await tasks.createMilestone(actor, {
          projectId: request.projectId,
          name: request.name,
          description: request.description,
          startAt: request.startAt,
          dueAt: request.dueAt,
        });
        return {
          result: { milestoneId: created.id, projectId: created.projectId },
          published: null,
          event: { type: "milestone.created", id: created.id },
        };
      },
    };
  }

  private async change(
    identity: AgentIdentity,
    operation: AgentMilestoneFieldOperation,
    parameters: unknown,
  ): Promise<AgentTicketCompleted<AgentMilestoneChanged>> {
    const request = readAgentMilestoneFieldChange(operation, parameters);
    return this.dependencies.transaction.run<AgentMilestoneChanged>({
      ...this.base(identity.userId, operation, request),
      work: async ({ actor, tasks }) => {
        // Only the named field is written, and only while it holds the value that was read.
        const updated = await tasks.updateMilestoneField(
          actor,
          request.milestoneId,
          {
            field: request.field,
            base: request.expected,
            value: request.value,
          },
        );
        return {
          result: {
            milestoneId: updated.milestone.id,
            projectId: updated.milestone.projectId,
            field: request.field,
            changed: updated.isChanged,
          },
          published: null,
          event: updated.isChanged
            ? { type: "milestone.updated", id: updated.milestone.id }
            : null,
        };
      },
    });
  }

  private async link(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<AgentTicketCompleted<AgentMilestoneDependencyChanged>> {
    return this.dependencies.transaction.run(
      this.linkRun(
        identity.userId,
        readAgentMilestoneDependencyAdd(parameters),
      ),
    );
  }

  private linkRun(
    userId: string,
    request: AgentMilestoneDependencyAddInput,
  ): AgentTicketRun<AgentMilestoneDependencyChanged> {
    return {
      ...this.base(userId, "milestone.dependency.add", request),
      work: async ({ actor, tasks }) => {
        const created = await tasks.addDependency(actor, {
          projectId: request.projectId,
          sourceId: request.sourceId,
          targetId: request.targetId,
          linkType: request.linkType,
        });
        return {
          result: describeDependency(created, false),
          published: null,
          event: { type: "milestone.updated", id: created.sourceId },
        };
      },
    };
  }

  private async unlink(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<AgentTicketCompleted<AgentMilestoneDependencyChanged>> {
    const request = readAgentMilestoneDependencyRemove(parameters);
    return this.dependencies.transaction.run<AgentMilestoneDependencyChanged>({
      ...this.base(identity.userId, "milestone.dependency.remove", request),
      work: async ({ actor, tasks, projects }) => {
        // The dependency is read first, because the result names what was removed.
        await projects.getById(actor, request.projectId);
        const dependency = (
          await tasks.findDependencies(actor, [request.projectId])
        ).find(({ id }) => id === request.dependencyId);
        if (!dependency) throw new AgentOperationError("NOT_FOUND");
        await tasks.removeDependency(
          actor,
          request.projectId,
          request.dependencyId,
        );
        return {
          result: describeDependency(dependency, true),
          published: null,
          event: { type: "milestone.updated", id: dependency.sourceId },
        };
      },
    });
  }

  /** The parts every milestone run shares: no global write right, and a visible project on repeat. */
  private base<Result extends ProjectBound>(
    userId: string,
    operation: string,
    request: { readonly operationId: string },
  ): Omit<AgentTicketRun<Result>, "work"> {
    return {
      userId,
      operation,
      request,
      needsWriteRight: false,
      revisit: revisitProject,
    };
  }
}
