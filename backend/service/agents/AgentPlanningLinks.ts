import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { readIdentifier } from "./AgentParameterReader";
import { readAgentTicketRead } from "./AgentTicketValidation";

import type { AgentExtensionChanged } from "@/definition/AgentExtensions";
import type { WorkItemDetail } from "@/definition/Task";
import type { AgentTaskContext } from "./AgentTaskAccess";

/** Most tags a ticket carries after one call. */
const MAXIMUM_TAGS = 50;

/** Reads a list of tag identifiers without duplicates. */
function readTagIds(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > MAXIMUM_TAGS)
    throw new AgentOperationError("INVALID_REQUEST");
  const ids = input.map(readIdentifier);
  if (new Set(ids).size !== ids.length)
    throw new AgentOperationError("INVALID_REQUEST");
  return ids;
}

function isSameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

async function requireTicket(
  context: AgentTaskContext,
  input: unknown,
): Promise<WorkItemDetail> {
  const reference = readAgentTicketRead({ ticketId: input });
  return "id" in reference
    ? context.tasks.getById(context.actor, reference.id)
    : context.tasks.getByKey(context.actor, reference.key);
}

/**
 * Replaces the tags of a ticket with tags of the catalog.
 *
 * @param context - The services of the call, bound to its transaction.
 * @param parameters - `ticketId`, the new `tagIds` and the `expectedTagIds` read before.
 * @returns The ticket and whether any tag was added or removed.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a tag outside the catalog,
 * `CONFLICT` when the tags changed since they were read.
 *
 * @remarks
 * Nothing creates a tag here: a tag that the catalog does not list is refused
 * as a whole, before the first tag changes (T6.13.4).
 */
export async function applyAgentTicketTags(
  context: AgentTaskContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentExtensionChanged> {
  const ticket = await requireTicket(context, parameters.ticketId);
  const tagIds = readTagIds(parameters.tagIds);
  const expected = readTagIds(parameters.expectedTagIds);
  const current = (
    (await context.tasks.findLabelsForWorkItems([ticket.id])).get(ticket.id) ??
    []
  ).map(({ id }) => id);

  // The stored tags count as the new ones when someone saved them meanwhile.
  if (!isSameSet(expected, current) && !isSameSet(tagIds, current))
    throw new AgentOperationError("CONFLICT");
  const catalog = new Set(
    (await context.tasks.findLabels()).map(({ id }) => id),
  );
  if (tagIds.some((id) => !catalog.has(id)))
    throw new AgentOperationError("INVALID_REQUEST");
  const added = tagIds.filter((id) => !current.includes(id));
  const removed = current.filter((id) => !tagIds.includes(id));
  for (const id of removed)
    await context.tasks.unassignLabel(context.actor, ticket.id, id);
  for (const id of added)
    await context.tasks.assignLabel(context.actor, ticket.id, id);
  return {
    id: ticket.id,
    projectId: ticket.projectId,
    changed: added.length + removed.length > 0,
  };
}

/**
 * Links an initiative with a milestone or removes the link.
 *
 * @param context - The services of the call, bound to its transaction.
 * @param operation - Whether the link is added or removed.
 * @param parameters - `projectId`, `milestoneId` and `initiativeId` (identifier or key).
 * @returns The milestone, the initiative as `relatedId` and whether anything changed.
 * @throws {AgentOperationError} `NOT_FOUND` for a hidden project, milestone or
 * initiative, `INVALID_REQUEST` for a ticket that is no initiative, `CONFLICT`
 * while epics, tasks or subtasks below the initiative still use the milestone.
 */
export async function applyAgentMilestoneInitiative(
  context: AgentTaskContext,
  operation: "milestone.initiative.add" | "milestone.initiative.remove",
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentExtensionChanged> {
  const projectId = readIdentifier(parameters.projectId);
  const milestoneId = readIdentifier(parameters.milestoneId);
  await context.projects.getById(context.actor, projectId);
  const initiative = await requireTicket(context, parameters.initiativeId);
  if (initiative.projectId !== projectId)
    throw new AgentOperationError("NOT_FOUND");
  const change =
    operation === "milestone.initiative.add"
      ? await context.tasks.linkInitiativeToMilestone(
          context.actor,
          milestoneId,
          initiative.id,
        )
      : await context.tasks.unlinkInitiativeFromMilestone(
          context.actor,
          milestoneId,
          initiative.id,
        );
  return {
    id: milestoneId,
    projectId,
    changed: change.isChanged,
    relatedId: initiative.id,
  };
}
