import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { createAgentTaskContext } from "./AgentTaskAccess";
import { translateAgentTicketError } from "./AgentTicketErrors";
import {
  readAgentMilestonesRead,
  readAgentTicketRead,
} from "./AgentTicketValidation";

import type { Database } from "@/backend/database/Database";
import type { UserService } from "@/backend/service/UserService";
import type { AgentMilestones, AgentTicket } from "@/definition/AgentTickets";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { AgentTaskContext } from "./AgentTaskAccess";

/** The server-owned collaborators of ticket and milestone reads. */
export interface AgentPlanningReadDependencies {
  readonly database: Database;
  readonly users: Pick<UserService, "getById">;
}

function describeTicket(
  ticket: WorkItemDetail,
  statuses: readonly WorkflowStatus[],
): AgentTicket {
  return {
    id: ticket.id,
    key: ticket.key,
    link: `/tasks/${ticket.key}`,
    projectId: ticket.projectId,
    type: ticket.type,
    title: ticket.title,
    description: ticket.description,
    priority: ticket.priority,
    statusId: ticket.statusId,
    statusName: ticket.statusName,
    isDone: ticket.isDone,
    parentId: ticket.parentId,
    parentKey: ticket.parentKey,
    milestoneId: ticket.milestoneId,
    milestoneName: ticket.milestoneName,
    startAt: ticket.startAt,
    dueAt: ticket.dueAt,
    isArchived: ticket.archivedAt !== null,
    statuses: statuses
      .filter(
        ({ projectId }) => projectId === null || projectId === ticket.projectId,
      )
      .map(({ id, name, isDone }) => ({ id, name, isDone })),
  };
}

/** Reads tickets and milestones for an agent, within the scope of its account. */
export class AgentPlanningReadService {
  private readonly dependencies: AgentPlanningReadDependencies;

  public constructor(dependencies: AgentPlanningReadDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads one visible ticket with the statuses its project offers.
   *
   * @param identity - The verified owner of the call.
   * @param parameters - The raw operation parameters: `ticketId` as identifier, key or address.
   * @returns The ticket; a hidden ticket is reported as missing.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `NOT_FOUND` or `PAYLOAD_TOO_LARGE`.
   */
  public async readTicket(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse> {
    const reference = readAgentTicketRead(parameters);
    const context = await this.context(identity);
    try {
      const ticket =
        "id" in reference
          ? await context.tasks.getById(context.actor, reference.id)
          : await context.tasks.getByKey(context.actor, reference.key);
      const statuses = await context.tasks.findAllStatuses(context.actor);
      return this.respond(describeTicket(ticket, statuses));
    } catch (error: unknown) {
      throw translateAgentTicketError(error);
    }
  }

  /**
   * Reads the milestones and dependencies of one visible project.
   *
   * @param identity - The verified owner of the call.
   * @param parameters - The raw operation parameters: `projectId`.
   * @returns The milestones; a project the account cannot see is reported as missing.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `NOT_FOUND` or `PAYLOAD_TOO_LARGE`.
   */
  public async readMilestones(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse> {
    const projectId = readAgentMilestonesRead(parameters);
    const context = await this.context(identity);
    try {
      await context.projects.getById(context.actor, projectId);
      const [milestones, dependencies] = await Promise.all([
        context.tasks.findMilestones(context.actor, [projectId]),
        context.tasks.findDependencies(context.actor, [projectId]),
      ]);
      const result: AgentMilestones = {
        projectId,
        milestones: milestones.map((milestone) => ({
          id: milestone.id,
          projectId: milestone.projectId,
          name: milestone.name,
          description: milestone.description,
          status: milestone.status,
          startAt: milestone.startAt,
          dueAt: milestone.dueAt,
        })),
        dependencies: dependencies.map((dependency) => ({
          id: dependency.id,
          sourceId: dependency.sourceId,
          targetId: dependency.targetId,
          linkType: dependency.linkType,
        })),
      };
      return this.respond(result);
    } catch (error: unknown) {
      throw translateAgentTicketError(error);
    }
  }

  private async context(identity: AgentIdentity): Promise<AgentTaskContext> {
    const actor = await this.dependencies.users.getById(identity.userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new McpAuthorizationError("invalid_token", 401);
    return createAgentTaskContext(this.dependencies.database, actor);
  }

  private respond(
    result: AgentTicket | AgentMilestones,
  ): PagesAgentReadResponse {
    const response: PagesAgentReadResponse = { apiVersion: "1", result };
    if (
      Buffer.byteLength(JSON.stringify(response)) >
      PAGES_AGENT_LIMITS.responseBytes
    )
      throw new AgentOperationError("PAYLOAD_TOO_LARGE");
    return response;
  }
}
