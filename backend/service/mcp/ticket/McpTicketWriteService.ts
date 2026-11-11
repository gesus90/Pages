import { WORK_ITEM_PRIORITY } from "@/definition/Task";

import {
  changesTicketFields,
  requireActiveTicket,
  requireExpected,
  requireLabels,
  resolveReferences,
  updateInput,
} from "./McpTicketChange";
import { McpTicketError } from "./McpTicketError";
import { currentTicket, projectTicket } from "./McpTicketProjection";
import { projectStatuses } from "./McpTicketReadService";

import type { CreateWorkItemInput } from "@/backend/service/task/TaskWriteService";
import type { WorkItemDetail } from "@/definition/Task";
import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";
import type { McpTicket } from "./McpTicketContract";
import type { McpTicketContext } from "./McpTicketContext";
import type {
  McpTicketCreateRequest,
  McpTicketPatchRequest,
  McpTicketPositionRequest,
} from "./McpTicketRequest";

/**
 * Finds a template the account may see.
 *
 * @throws {McpTicketError} `not_found` for an unknown or hidden template.
 */
async function requireTemplate(
  context: McpTicketContext,
  templateId: string,
): Promise<WorkItemTemplateView> {
  const template = (
    await context.services.templates.findVisible(context.actor)
  ).find((candidate) => candidate.id === templateId);
  if (!template) throw new McpTicketError("not_found");
  return template;
}

/** The first status of a project, which a new ticket starts in without one. */
async function firstStatusId(
  context: McpTicketContext,
  projectId: string,
): Promise<string> {
  const [status] = await projectStatuses(context, projectId);
  if (!status) throw new McpTicketError("invalid_request");
  return status.id;
}

/** Resolves the person, the parent and the status of a new ticket. */
async function createReferences(
  context: McpTicketContext,
  request: McpTicketCreateRequest,
): Promise<Pick<CreateWorkItemInput, "assigneeId" | "parentId" | "statusId">> {
  const assigneeId =
    request.assignee === undefined || request.assignee === null
      ? null
      : await context.requireAssignablePerson(
          request.projectId,
          request.assignee,
        );
  const parentId =
    request.parent === undefined || request.parent === null
      ? null
      : (await context.ticket(request.parent)).id;
  const statusId =
    request.statusId ?? (await firstStatusId(context, request.projectId));
  return { assigneeId, parentId, statusId };
}

/** The values a template presets; the body wins where it names them. */
function presetValues(
  request: McpTicketCreateRequest,
  template: WorkItemTemplateView | null,
): Pick<CreateWorkItemInput, "type" | "title" | "description" | "priority"> {
  const type = request.type ?? template?.type;
  const title = request.title ?? template?.title;
  if (type === undefined || title === undefined)
    throw new McpTicketError("invalid_request");
  return {
    type,
    title,
    description: request.description ?? template?.description ?? "",
    priority:
      request.priority ?? template?.priority ?? WORK_ITEM_PRIORITY.NORMAL,
  };
}

/**
 * Rejects a body that assigns a person and a group at once.
 *
 * @throws {McpTicketError} `invalid_request`.
 */
function rejectDoubleAssignment(request: {
  readonly assignee?: string | null;
  readonly assigneeGroupId?: string | null;
  readonly departmentId?: string | null;
  readonly departmentIds?: readonly string[];
}): void {
  if (
    typeof request.assignee === "string" &&
    typeof request.assigneeGroupId === "string"
  )
    throw new McpTicketError("invalid_request");
  // The single and the list field would say two things about the departments.
  if (request.departmentId !== undefined && request.departmentIds !== undefined)
    throw new McpTicketError("invalid_request");
}

/** The departments a change sets: the list, or the older single field as a list of at most one. */
function requestedDepartmentIds(
  request: McpTicketPatchRequest,
): readonly string[] | undefined {
  if (request.departmentIds !== undefined) return request.departmentIds;
  if (request.departmentId === undefined) return undefined;
  return request.departmentId === null ? [] : [request.departmentId];
}

/** The optional values of a new ticket; absent means none. */
function optionalValues(
  request: McpTicketCreateRequest,
): Pick<
  CreateWorkItemInput,
  "assigneeGroupId" | "departmentIds" | "milestoneId" | "startAt" | "dueAt"
> {
  return {
    assigneeGroupId: request.assigneeGroupId ?? null,
    departmentIds:
      request.departmentIds ??
      (request.departmentId ? [request.departmentId] : []),
    milestoneId: request.milestoneId ?? null,
    startAt: request.startAt ?? null,
    dueAt: request.dueAt ?? null,
  };
}

/** Creates, changes, places and moves tickets (PAGE-242, interface 5–8). */
export class McpTicketWriteService {
  /**
   * Creates a ticket, from a template when the body names one.
   *
   * @param context - The request.
   * @param request - The validated body.
   * @returns The new ticket.
   */
  public async create(
    context: McpTicketContext,
    request: McpTicketCreateRequest,
  ): Promise<McpTicket> {
    const { actor, services } = context;
    rejectDoubleAssignment(request);
    await services.projects.getById(actor, request.projectId);
    const template =
      request.templateId === undefined
        ? null
        : await requireTemplate(context, request.templateId);
    const labelIds = request.labelIds ?? [];
    await requireLabels(context, labelIds);
    const input: CreateWorkItemInput = {
      ...presetValues(request, template),
      ...(await createReferences(context, request)),
      ...optionalValues(request),
      projectId: request.projectId,
    };
    const created =
      template === null
        ? await services.tasks.create(actor, input)
        : await services.templates.createFromTemplate(
            actor,
            template.id,
            input,
          );
    for (const labelId of labelIds)
      await services.tasks.assignLabel(actor, created.id, labelId);
    return currentTicket(context, created.id);
  }

  /**
   * Changes the named fields of a ticket.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @param request - The validated body.
   * @returns The changed ticket.
   * @throws {McpTicketError} `conflict` when a value of `expected` changed;
   * nothing is written then.
   *
   * @remarks
   * Every reference and every expected value is checked before the first
   * write. The fields go through the complete edit of the interface, the
   * department through its own action and the labels through assigning and
   * removing, exactly as the interface saves them.
   */
  public async patch(
    context: McpTicketContext,
    reference: string,
    request: McpTicketPatchRequest,
  ): Promise<McpTicket> {
    const { actor, services } = context;
    rejectDoubleAssignment(request);
    const ticket = await context.ticket(reference);
    requireActiveTicket(ticket);
    if (request.expected)
      await requireExpected(context, ticket, request.expected);
    const references = await resolveReferences(context, ticket, request);
    if (request.labelIds) await requireLabels(context, request.labelIds);
    const departmentIds = requestedDepartmentIds(request);
    if (departmentIds !== undefined)
      await this.requireSelectableDepartments(context, ticket, departmentIds);
    if (changesTicketFields(request))
      await services.tasks.update(
        actor,
        ticket.id,
        updateInput(ticket, request, references),
      );
    if (departmentIds !== undefined)
      await services.tasks.setDepartments(
        actor,
        ticket.id,
        departmentIds,
        ticket.departmentIds,
      );
    if (request.labelIds)
      await this.replaceLabels(context, ticket, request.labelIds);
    return currentTicket(context, ticket.id);
  }

  /**
   * Sets status and order in the column, like dragging on the board.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @param request - The validated body.
   */
  public async position(
    context: McpTicketContext,
    reference: string,
    request: McpTicketPositionRequest,
  ): Promise<McpTicket> {
    const ticket = await context.ticket(reference);
    requireActiveTicket(ticket);
    await context.services.tasks.updateStatusAndOrder(
      context.actor,
      ticket.id,
      request.statusId,
      request.sortOrder,
    );
    return currentTicket(context, ticket.id);
  }

  /**
   * Moves a ticket with its subtasks into another project.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @param projectId - The target project; the account needs the write right there too.
   * @returns The moved ticket with its new key.
   */
  public async move(
    context: McpTicketContext,
    reference: string,
    projectId: string,
  ): Promise<McpTicket> {
    const ticket = await context.ticket(reference);
    requireActiveTicket(ticket);
    const moved = await context.services.tasks.moveToProject(
      context.actor,
      ticket.id,
      projectId,
    );
    return projectTicket(context, moved);
  }

  /**
   * Lets the department action decide departments the account may not
   * choose before anything else is written.
   */
  private async requireSelectableDepartments(
    context: McpTicketContext,
    ticket: WorkItemDetail,
    departmentIds: readonly string[],
  ): Promise<void> {
    const { available } = await context.services.tasks.departmentChoices(
      context.actor,
    );
    const selectable = (id: string): boolean =>
      available.some((department) => department.id === id);
    const added = departmentIds.filter(
      (id) => !ticket.departmentIds.includes(id),
    );
    const removed =
      departmentIds.length === 0
        ? []
        : ticket.departmentIds.filter((id) => !departmentIds.includes(id));
    if (added.every(selectable) && removed.every(selectable)) return;
    // Raises not_found or forbidden exactly as the department action does.
    await context.services.tasks.setDepartments(
      context.actor,
      ticket.id,
      departmentIds,
      ticket.departmentIds,
    );
  }

  /** Replaces the labels of a ticket by assigning and removing single labels. */
  private async replaceLabels(
    context: McpTicketContext,
    ticket: WorkItemDetail,
    labelIds: readonly string[],
  ): Promise<void> {
    const { actor, services } = context;
    const wanted = new Set(labelIds);
    const current = (
      (await services.tasks.findLabelsForWorkItems([ticket.id])).get(
        ticket.id,
      ) ?? []
    ).map((label) => label.id);
    for (const labelId of current)
      if (!wanted.has(labelId))
        await services.tasks.unassignLabel(actor, ticket.id, labelId);
    for (const labelId of wanted)
      if (!current.includes(labelId))
        await services.tasks.assignLabel(actor, ticket.id, labelId);
  }
}
