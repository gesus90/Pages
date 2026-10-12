import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { readAgentDirectory } from "./AgentDirectoryService";

import type { AgentTicketCreateInput } from "@/definition/AgentTickets";
import type { WorkItemDetail } from "@/definition/Task";
import type { AgentTaskContext } from "./AgentTaskAccess";

/** The values a ticket is created with once everything the call left open is settled. */
export interface ResolvedTicketCreate {
  readonly projectId: string;
  readonly milestoneId: string | null;
  readonly departmentId: string | null;
  readonly assigneeId: string | null;
  readonly assigneeGroupId: string | null;
}

interface ResolvedAssignment {
  readonly assigneeId: string | null;
  readonly assigneeGroupId: string | null;
}

const UNASSIGNED: ResolvedAssignment = {
  assigneeId: null,
  assigneeGroupId: null,
};

/**
 * Takes a create call exactly as stated, without defaults.
 *
 * @param request - The create contract.
 * @returns The values to create the ticket with.
 * @throws {AgentOperationError} `INVALID_REQUEST` when the call names no project.
 *
 * @remarks
 * Callers that supply every value themselves, such as the structured import,
 * stay exactly as they were: nothing is inherited and nobody is assigned.
 */
export function takeStatedTicketCreate(
  request: AgentTicketCreateInput,
): ResolvedTicketCreate {
  if (request.projectId === null)
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    projectId: request.projectId,
    milestoneId: request.milestoneId,
    departmentId: null,
    ...UNASSIGNED,
  };
}

/**
 * Settles what a create call leaves open from the parent and the account.
 *
 * @param context - The services of the call, bound to the creating account.
 * @param request - The create contract.
 * @param parent - The visible parent the call names, or `null`.
 * @returns The values to create the ticket with.
 * @throws {AgentOperationError} `INVALID_REQUEST` without a project, `NOT_FOUND`
 * for a department, person or group the account cannot see.
 *
 * @remarks
 * The project, the milestone and the department come from the parent, but
 * only what the parent carries and the account may use is taken; nothing is
 * invented. A value the call states wins over the parent. A parent in another
 * project than the stated one fails in the hierarchy rules of the ticket
 * service, like every parent of the wrong project.
 */
export async function resolveAgentTicketCreate(
  context: AgentTaskContext,
  request: AgentTicketCreateInput,
  parent: WorkItemDetail | null,
): Promise<ResolvedTicketCreate> {
  const projectId = request.projectId ?? parent?.projectId;
  if (projectId === undefined) throw new AgentOperationError("INVALID_REQUEST");
  return {
    projectId,
    milestoneId: request.milestoneId ?? parent?.milestoneId ?? null,
    departmentId: await resolveDepartment(context, request, parent),
    ...(await resolveAssignment(context, request, projectId)),
  };
}

async function resolveDepartment(
  context: AgentTaskContext,
  request: AgentTicketCreateInput,
  parent: WorkItemDetail | null,
): Promise<string | null> {
  const stated = request.departmentId ?? null;
  if (stated !== null) {
    const { departments } = await readAgentDirectory(context);
    // A department the account cannot see is reported like one that does not exist.
    if (!departments.some(({ id }) => id === stated))
      throw new AgentOperationError("NOT_FOUND");
    return stated;
  }
  const inherited = parent?.departmentId ?? null;
  if (inherited === null) return null;
  // The parent is visible, but its department may be one the account cannot select.
  const { available } = await context.tasks.departmentChoices(context.actor);
  return available.some(({ id }) => id === inherited) ? inherited : null;
}

async function resolveAssignment(
  context: AgentTaskContext,
  request: AgentTicketCreateInput,
  projectId: string,
): Promise<ResolvedAssignment> {
  const stated = request.assignee ?? null;
  if (stated === null) return defaultAssignment(context, projectId);
  if (stated.targetType === "none" || stated.targetId === null)
    return UNASSIGNED;
  const { targetId } = stated;
  const directory = await readAgentDirectory(context);
  if (
    stated.targetType === "person" &&
    directory.people.some(({ id }) => id === targetId)
  )
    return { assigneeId: targetId, assigneeGroupId: null };
  if (
    stated.targetType === "group" &&
    directory.groups.some(({ id }) => id === targetId)
  )
    return { assigneeId: null, assigneeGroupId: targetId };
  throw new AgentOperationError("NOT_FOUND");
}

/** The account that creates the ticket, when it may be assigned in the project. */
async function defaultAssignment(
  context: AgentTaskContext,
  projectId: string,
): Promise<ResolvedAssignment> {
  const eligible = await context.tasks.findEligibleAssignees(
    context.actor,
    projectId,
  );
  return eligible.some(({ id }) => id === context.actor.id)
    ? { assigneeId: context.actor.id, assigneeGroupId: null }
    : UNASSIGNED;
}
