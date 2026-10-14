import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { pageAgentEntries } from "./AgentCursor";
import { readAgentDirectory } from "./AgentDirectoryService";
import { readIdentifier, readParameterRecord } from "./AgentParameterReader";
import {
  countAgentDescendants,
  readAgentAnchoredPages,
  readAgentInitiativeLinks,
  readAgentTicketLinks,
  readAgentTicketTags,
} from "./AgentPlanningEnrichment";
import { createAgentTaskContext } from "./AgentTaskAccess";
import { translateAgentTicketError } from "./AgentTicketErrors";
import {
  readAgentMilestonesRead,
  readAgentTicketDescriptionRange,
  readAgentTicketRead,
} from "./AgentTicketValidation";
import { agentTextVersion, indexText, readTextRange } from "./AgentTextRange";
import { agentTicketLink, requireAgentTicket } from "./AgentTicketLookup";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { Database } from "@/backend/database/Database";
import type { UserService } from "@/backend/service/UserService";
import type { AgentTag } from "@/definition/AgentExtensions";
import type { AgentTicketDescriptionRange } from "@/definition/AgentTextRange";
import type { AgentMilestones, AgentTicket } from "@/definition/AgentTickets";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { AgentTaskContext } from "./AgentTaskAccess";
import type { AgentProjectTickets } from "@/definition/AgentExtensions";

/** The server-owned collaborators of ticket and milestone reads. */
export interface AgentPlanningReadDependencies {
  readonly database: Database;
  readonly users: Pick<UserService, "getById">;
  /** The agent surface the reads run for; MCP when absent. */
  readonly channel?: AgentChannel;
}

function describeTicket(
  ticket: WorkItemDetail,
  statuses: readonly WorkflowStatus[],
  tags: readonly AgentTag[],
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
    tags,
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
      const directory = await readAgentDirectory(context);
      const tags = await readAgentTicketTags(context, [ticket.id]);
      return this.respond({
        ...describeTicket(ticket, statuses, tags.get(ticket.id) ?? []),
        ...(await readAgentTicketLinks(context, ticket)),
        descendantCount: await countAgentDescendants(context, ticket),
        assignee:
          directory.people.find(({ id }) => id === ticket.assigneeId) ?? null,
        assigneeGroup:
          directory.groups
            .filter(({ id }) => id === ticket.assigneeGroupId)
            .map(({ id, name }) => ({ id, name }))[0] ?? null,
        department:
          directory.departments.find(({ id }) => id === ticket.departmentId) ??
          null,
      });
    } catch (error: unknown) {
      throw translateAgentTicketError(error);
    }
  }

  /**
   * Reads one passage of the description of a visible ticket.
   *
   * @param identity - The verified owner of the call.
   * @param parameters - The raw operation parameters: `ticketId`, `start`, optional `end` and `maxCharacters`.
   * @returns The passage, its absolute positions, the version of the description and its size; never the whole text.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `NOT_FOUND` or `PAYLOAD_TOO_LARGE`.
   *
   * @remarks
   * A hidden ticket is reported as missing, exactly like in a full read.
   */
  public async readDescriptionRange(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse> {
    const request = readAgentTicketDescriptionRange(parameters);
    const context = await this.context(identity);
    try {
      const ticket = await requireAgentTicket(context, request.ticket);
      return this.respond({
        ticketId: ticket.id,
        key: ticket.key,
        link: agentTicketLink(ticket.key),
        descriptionVersion: agentTextVersion(ticket.description),
        ...readTextRange(indexText(ticket.description), request.range),
      });
    } catch (error: unknown) {
      throw translateAgentTicketError(error);
    }
  }

  /** Lists the visible tickets of a project with a stable continuation cursor. */
  public async readProjectTickets(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse> {
    const fields = readParameterRecord(parameters);
    const projectId = readIdentifier(fields.projectId);
    const context = await this.context(identity);
    try {
      await context.projects.getById(context.actor, projectId);
      const statuses = await context.tasks.findAllStatuses(context.actor);
      const tickets = (await context.tasks.findAll(context.actor)).filter(
        (ticket) => ticket.projectId === projectId,
      );
      const directory = await readAgentDirectory(context);
      const window = pageAgentEntries(tickets, {
        cursor: fields.cursor,
        limit: fields.limit,
        context: JSON.stringify([
          identity.userId,
          "projects.tickets.list",
          projectId,
        ]),
      });
      const tags = await readAgentTicketTags(
        context,
        window.entries.map(({ id }) => id),
      );
      const links = await readAgentInitiativeLinks(context, projectId);
      const result = {
        ...window,
        entries: window.entries.map((ticket) => ({
          ...describeTicket(ticket, statuses, tags.get(ticket.id) ?? []),
          ...(ticket.type === "initiative"
            ? {
                linkedMilestones:
                  links.milestonesByInitiative.get(ticket.id) ?? [],
              }
            : {}),
          assignee:
            directory.people.find(({ id }) => id === ticket.assigneeId) ?? null,
          assigneeGroup:
            directory.groups
              .filter(({ id }) => id === ticket.assigneeGroupId)
              .map(({ id, name }) => ({ id, name }))[0] ?? null,
          department:
            directory.departments.find(
              ({ id }) => id === ticket.departmentId,
            ) ?? null,
        })),
      };
      return this.respond({
        projectId,
        tickets: result.entries,
        total: result.total,
        nextCursor: result.nextCursor,
      });
    } catch (error: unknown) {
      throw translateAgentTicketError(error);
    }
  }

  /** Reads the milestones and dependencies of one visible project with cursor navigation. */
  public async readMilestones(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse> {
    const fields = readParameterRecord(parameters);
    if (
      Object.keys(fields).some(
        (key) => !["projectId", "cursor", "limit"].includes(key),
      )
    )
      throw new AgentOperationError("INVALID_REQUEST");
    const projectId = readAgentMilestonesRead({ projectId: fields.projectId });
    const context = await this.context(identity);
    try {
      await context.projects.getById(context.actor, projectId);
      const [milestones, dependencies] = await Promise.all([
        context.tasks.findMilestones(context.actor, [projectId]),
        context.tasks.findDependencies(context.actor, [projectId]),
      ]);
      const window = pageAgentEntries(
        [
          ...milestones.map((milestone) => ({
            id: `milestone:${milestone.id}`,
            milestone,
            dependency: null,
          })),
          ...dependencies.map((dependency) => ({
            id: `dependency:${dependency.id}`,
            milestone: null,
            dependency,
          })),
        ],
        {
          cursor: fields.cursor,
          limit: fields.limit,
          context: JSON.stringify([
            identity.userId,
            "milestones.read",
            projectId,
          ]),
        },
      );
      const links = await readAgentInitiativeLinks(context, projectId);
      const initiatives = await context.tasks.findAll(context.actor, {
        archived: "active",
        projectIds: [projectId],
        type: "initiative",
      });
      const pages = await readAgentAnchoredPages(
        context,
        "milestone",
        window.entries.flatMap(({ milestone }) =>
          milestone ? [milestone.id] : [],
        ),
      );
      const result: AgentMilestones = {
        total: window.total,
        nextCursor: window.nextCursor,
        projectId,
        milestones: window.entries.flatMap(({ milestone }) =>
          milestone
            ? [
                {
                  id: milestone.id,
                  projectId: milestone.projectId,
                  name: milestone.name,
                  description: milestone.description,
                  status: milestone.status,
                  startAt: milestone.startAt,
                  dueAt: milestone.dueAt,
                  initiatives: initiatives
                    .filter(({ id }) =>
                      (
                        links.initiativesByMilestone.get(milestone.id) ?? []
                      ).includes(id),
                    )
                    .map(({ id, key, title }) => ({ id, key, title })),
                  wikiPages: pages.get(milestone.id) ?? [],
                },
              ]
            : [],
        ),
        dependencies: window.entries.flatMap(({ dependency }) =>
          dependency
            ? [
                {
                  id: dependency.id,
                  sourceId: dependency.sourceId,
                  targetId: dependency.targetId,
                  linkType: dependency.linkType,
                },
              ]
            : [],
        ),
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
    return createAgentTaskContext(
      this.dependencies.database,
      actor,
      this.dependencies.channel,
    );
  }

  private respond(
    result:
      | AgentTicket
      | AgentTicketDescriptionRange
      | AgentMilestones
      | AgentProjectTickets,
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
