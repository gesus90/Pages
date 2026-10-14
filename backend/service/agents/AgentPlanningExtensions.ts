import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { readAgentDirectory } from "./AgentDirectoryService";
import { readIdentifier } from "./AgentParameterReader";
import { readAgentTicketRead } from "./AgentTicketValidation";
import { requireAgentConfirmation } from "./AgentConfirmation";

import type {
  AgentExtensionChanged,
  AgentExtensionWriteOperation,
} from "@/definition/AgentExtensions";
import type { WorkItemDetail } from "@/definition/Task";
import type { AgentTaskContext } from "./AgentTaskAccess";

/** Applies ticket assignments and soft archiving with the same authorization as the UI. */
export async function applyAgentPlanningExtension(
  context: AgentTaskContext,
  operation: AgentExtensionWriteOperation,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentExtensionChanged> {
  if (operation === "milestone.delete") {
    await requireAgentConfirmation(
      context.database,
      context.actor.id,
      parameters.confirmation,
    );
    const projectId = readIdentifier(parameters.projectId);
    const id = readIdentifier(parameters.milestoneId);
    await context.projects.getById(context.actor, projectId);
    if (
      !(await context.tasks.findMilestones(context.actor, [projectId])).some(
        (milestone) => milestone.id === id,
      )
    )
      throw new AgentOperationError("NOT_FOUND");
    await context.tasks.archiveMilestone(context.actor, id);
    return {
      id,
      projectId,
      changed: true,
      affectedCount: 1,
      disposition: "trash",
    };
  }
  const reference = readAgentTicketRead({ ticketId: parameters.ticketId });
  const ticket =
    "id" in reference
      ? await context.tasks.getById(context.actor, reference.id)
      : await context.tasks.getByKey(context.actor, reference.key);
  if (operation === "ticket.delete") {
    await requireAgentConfirmation(
      context.database,
      context.actor.id,
      parameters.confirmation,
    );
    const affectedCount = await context.tasks.archive(
      context.actor,
      ticket.id,
      "include",
    );
    return {
      id: ticket.id,
      projectId: ticket.projectId,
      changed: affectedCount > 0,
      affectedCount,
      recursive: true,
      disposition: "trash",
    };
  }
  if (
    operation === "ticket.setAssignee" &&
    parameters.targetType === "department"
  )
    return assignTicketDepartment(context, parameters, ticket);
  const assignment = await ticketAssignment(
    context,
    operation,
    parameters,
    ticket,
  );
  await context.tasks.update(context.actor, ticket.id, {
    title: ticket.title,
    statusId: ticket.statusId,
    priority: ticket.priority,
    assigneeId: ticket.assigneeId,
    assigneeGroupId: ticket.assigneeGroupId,
    reporterId: ticket.createdBy,
    parentId: ticket.parentId,
    milestoneId: ticket.milestoneId,
    dueAt: ticket.dueAt,
    startAt: ticket.startAt,
    ...assignment,
  });
  return { id: ticket.id, projectId: ticket.projectId, changed: true };
}

function nullableIdentifier(input: unknown): string | null {
  return input === null ? null : readIdentifier(input);
}

function visibleAssignmentId(
  entries: readonly { readonly id: string }[],
  assignmentId: string | null,
): string | null {
  return entries.some(({ id }) => id === assignmentId) ? assignmentId : null;
}

async function assignTicketDepartment(
  context: AgentTaskContext,
  parameters: Readonly<Record<string, unknown>>,
  ticket: WorkItemDetail,
): Promise<AgentExtensionChanged> {
  const expected = nullableIdentifier(parameters.expectedDepartmentId);
  const departmentId = nullableIdentifier(parameters.targetId);
  const { departments } = await readAgentDirectory(context);
  if (expected !== visibleAssignmentId(departments, ticket.departmentId))
    throw new AgentOperationError("CONFLICT");
  if (
    departmentId !== null &&
    !departments.some(({ id }) => id === departmentId)
  )
    throw new AgentOperationError("NOT_FOUND");
  await context.tasks.setDepartment(context.actor, ticket.id, departmentId);
  return {
    id: ticket.id,
    projectId: ticket.projectId,
    changed: departmentId !== ticket.departmentId,
  };
}

async function ticketAssignment(
  context: AgentTaskContext,
  operation: AgentExtensionWriteOperation,
  parameters: Readonly<Record<string, unknown>>,
  ticket: WorkItemDetail,
): Promise<{
  readonly milestoneId?: string | null;
  readonly assigneeId?: string | null;
  readonly assigneeGroupId?: string | null;
}> {
  if (operation === "ticket.assignMilestone") {
    const expected = nullableIdentifier(parameters.expectedMilestoneId);
    const next = nullableIdentifier(parameters.milestoneId);
    if (expected !== ticket.milestoneId)
      throw new AgentOperationError("CONFLICT");
    return { milestoneId: next };
  }
  if (operation !== "ticket.setAssignee")
    throw new AgentOperationError("INVALID_REQUEST");
  const directory = await readAgentDirectory(context);
  if (
    nullableIdentifier(parameters.expectedAssigneeId) !==
      visibleAssignmentId(directory.people, ticket.assigneeId) ||
    nullableIdentifier(parameters.expectedAssigneeGroupId) !==
      visibleAssignmentId(directory.groups, ticket.assigneeGroupId)
  )
    throw new AgentOperationError("CONFLICT");
  if (parameters.targetType === "none" && parameters.targetId === null)
    return { assigneeId: null, assigneeGroupId: null };
  if (parameters.targetType !== "person" && parameters.targetType !== "group")
    throw new AgentOperationError("INVALID_REQUEST");
  const id = readIdentifier(parameters.targetId);
  if (
    parameters.targetType === "person" &&
    directory.people.some((person) => person.id === id)
  )
    return { assigneeId: id, assigneeGroupId: null };
  if (
    parameters.targetType === "group" &&
    directory.groups.some((group) => group.id === id)
  )
    return { assigneeId: null, assigneeGroupId: id };
  throw new AgentOperationError("NOT_FOUND");
}
