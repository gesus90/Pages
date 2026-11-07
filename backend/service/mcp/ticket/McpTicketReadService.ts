import { McpTicketError } from "./McpTicketError";
import {
  projectSummary,
  projectTicket,
  toIsoTimestamp,
} from "./McpTicketProjection";

import type { FindWorkItemsOptions } from "@/backend/database/repositories/TaskRepository";
import type { WorkflowStatus } from "@/definition/Task";
import type {
  McpTicket,
  McpTicketHistoryEntry,
  McpTicketNamed,
  McpTicketOptions,
  McpTicketPerson,
  McpTicketSummary,
} from "./McpTicketContract";
import type { McpTicketContext } from "./McpTicketContext";
import type { McpTicketSearchRequest } from "./McpTicketRequest";

/** The answer of a ticket search. */
export interface McpTicketSearchResult {
  readonly tickets: readonly McpTicketSummary[];
  readonly total: number;
}

/**
 * Returns the statuses of a project in board order.
 *
 * @param context - The request; only statuses of visible projects are read.
 * @param projectId - A project the account may see.
 */
export async function projectStatuses(
  context: McpTicketContext,
  projectId: string,
): Promise<WorkflowStatus[]> {
  const statuses = await context.services.tasks.findAllStatuses(context.actor);
  return statuses
    .filter(
      (status) => status.projectId === null || status.projectId === projectId,
    )
    .sort((first, second) => first.position - second.position);
}

/** Choices, search, single reads and activity of tickets (PAGE-242, interface 1–4). */
export class McpTicketReadService {
  /**
   * Returns the choices of a project for creating and changing tickets.
   *
   * @param context - The request.
   * @param projectId - A project the account may see.
   * @throws {McpTicketError} `not_found` for a hidden project.
   */
  public async options(
    context: McpTicketContext,
    projectId: string,
  ): Promise<McpTicketOptions> {
    const { actor, services } = context;
    await services.projects.getById(actor, projectId);
    const [statuses, milestones, labels, templates, assignable] =
      await Promise.all([
        projectStatuses(context, projectId),
        services.tasks.findMilestones(actor, [projectId]),
        services.tasks.findLabels(),
        services.templates.findVisible(actor),
        this.assignable(context, projectId),
      ]);
    return {
      statuses: statuses.map(({ id, name, isDone }) => ({ id, name, isDone })),
      milestones: milestones.map(({ id, name }) => ({ id, name })),
      labels: labels.map(({ id, name, color }) => ({ id, name, color })),
      templates: templates.map(({ id, name, type }) => ({ id, name, type })),
      ...assignable,
    };
  }

  /**
   * Searches the tickets of a project, ordered by ticket number.
   *
   * @param context - The request.
   * @param request - The validated filters.
   * @throws {McpTicketError} `forbidden` for archived tickets without the
   * archive right, `not_found` for a hidden project or an unknown filter value.
   */
  public async search(
    context: McpTicketContext,
    request: McpTicketSearchRequest,
  ): Promise<McpTicketSearchResult> {
    const { actor, services } = context;
    await services.projects.getById(actor, request.projectId);
    if (
      request.archived === "1" &&
      !(await services.tasks.canArchive(actor, request.projectId))
    )
      throw new McpTicketError("forbidden");
    const found = await services.tasks.findAll(
      actor,
      await this.searchOptions(context, request),
    );
    const sorted = [...found].sort(
      (first, second) => first.number - second.number,
    );
    const page = sorted.slice(request.offset, request.offset + request.limit);
    const labels = await services.tasks.findLabelsForWorkItems(
      page.map((item) => item.id),
    );
    return {
      tickets: await Promise.all(
        page.map((item) =>
          projectSummary(context, item, labels.get(item.id) ?? []),
        ),
      ),
      total: sorted.length,
    };
  }

  /**
   * Reads one ticket, archived ones included.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   */
  public async read(
    context: McpTicketContext,
    reference: string,
  ): Promise<McpTicket> {
    return projectTicket(context, await context.ticket(reference));
  }

  /**
   * Reads the activity of a ticket, newest first: the entries the interface
   * shows under "Aktivität".
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   */
  public async history(
    context: McpTicketContext,
    reference: string,
  ): Promise<McpTicketHistoryEntry[]> {
    const ticket = await context.ticket(reference);
    const entries = await context.services.tasks.getHistory(
      context.actor,
      ticket.id,
    );
    const ordered = [...entries].sort((first, second) =>
      second.createdAt.localeCompare(first.createdAt),
    );
    return Promise.all(
      ordered.map(async (entry) => ({
        user: await context.person(entry.userId),
        action: entry.action,
        field: entry.field,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        createdAt: toIsoTimestamp(entry.createdAt),
      })),
    );
  }

  /**
   * The people, groups and departments the account may choose in a project.
   *
   * @remarks
   * Without the write right the account assigns nothing, so all three are empty.
   */
  private async assignable(
    context: McpTicketContext,
    projectId: string,
  ): Promise<{
    readonly people: readonly McpTicketPerson[];
    readonly groups: readonly McpTicketNamed[];
    readonly departments: readonly McpTicketNamed[];
  }> {
    const { actor, services } = context;
    const { canWrite } = await services.tasks.actionPermissions(actor);
    if (!canWrite) return { people: [], groups: [], departments: [] };
    const [people, groups, departments] = await Promise.all([
      services.tasks.findEligibleAssignees(actor, projectId),
      services.tasks.findAssigneeGroups(actor),
      services.tasks.departmentChoices(actor),
    ]);
    const groupIds = new Set(
      (
        await services.tasks.findAssigneeGroupIdsByProject(actor, {
          [projectId]: people,
        })
      )[projectId] ?? [],
    );
    return {
      people: people.map(({ username, displayName }) => ({
        username,
        displayName,
      })),
      groups: groups
        .filter((group) => groupIds.has(group.id))
        .map(({ id, name }) => ({ id, name })),
      departments: departments.available.map(({ id, name }) => ({ id, name })),
    };
  }

  /** Translates the filters of the interface into the query of the ticket service. */
  private async searchOptions(
    context: McpTicketContext,
    request: McpTicketSearchRequest,
  ): Promise<FindWorkItemsOptions> {
    await this.requireFilterValues(context, request);
    const assignee =
      request.assignee === undefined
        ? undefined
        : await context.requireVisiblePerson(request.assignee);
    const parent =
      request.parent === undefined
        ? undefined
        : await context.ticket(request.parent);
    return {
      projectIds: [request.projectId],
      archived: request.archived === "1" ? "archived" : "active",
      search: request.text,
      searchDescription: request.text !== undefined,
      type: request.type,
      statusId: request.statusId,
      assigneeId: assignee?.id,
      assigneeGroupId: request.assigneeGroupId,
      labelIds: request.labelId === undefined ? undefined : [request.labelId],
      milestoneId: request.milestoneId,
      parentId: parent?.id,
    };
  }

  /** Rejects a filter that names a status, milestone, label or group that does not exist. */
  private async requireFilterValues(
    context: McpTicketContext,
    request: McpTicketSearchRequest,
  ): Promise<void> {
    const { actor, services } = context;
    const { statusId, milestoneId, labelId, assigneeGroupId } = request;
    const lookups: (() => Promise<boolean>)[] = [];
    if (statusId !== undefined)
      lookups.push(async () =>
        (await projectStatuses(context, request.projectId)).some(
          (status) => status.id === statusId,
        ),
      );
    if (milestoneId !== undefined)
      lookups.push(async () =>
        (await services.tasks.findMilestones(actor, [request.projectId])).some(
          (milestone) => milestone.id === milestoneId,
        ),
      );
    if (labelId !== undefined)
      lookups.push(async () =>
        (await services.tasks.findLabels()).some(
          (label) => label.id === labelId,
        ),
      );
    if (assigneeGroupId !== undefined)
      lookups.push(async () =>
        (await services.tasks.findAssigneeGroups(actor)).some(
          (group) => group.id === assigneeGroupId,
        ),
      );
    const found = await Promise.all(lookups.map((lookup) => lookup()));
    if (found.includes(false)) throw new McpTicketError("not_found");
  }
}
