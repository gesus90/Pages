import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { requireAgentTicket } from "./AgentTicketLookup";

import type { FindWorkItemsOptions } from "@/backend/database/repositories/TaskRepository";
import type { AgentTicketSearchInput } from "@/definition/AgentTicketNavigation";
import type { AgentDirectory } from "./AgentDirectoryService";
import type { AgentTaskContext } from "./AgentTaskAccess";

const SNIPPET_CHARACTERS = 200;

/** Reports a reference that does not resolve for the account like a hidden one. */
function requireKnown(isKnown: boolean): void {
  if (!isKnown) throw new AgentOperationError("NOT_FOUND");
}

function isListed(
  entries: readonly { readonly id: string }[],
  id: string | undefined,
): boolean {
  return id === undefined || entries.some((entry) => entry.id === id);
}

async function requireKnownCatalogs(
  context: AgentTaskContext,
  search: AgentTicketSearchInput,
): Promise<void> {
  const { actor, tasks } = context;
  const statuses = (await tasks.findAllStatuses(actor)).filter(
    ({ projectId }) => projectId === null || projectId === search.projectId,
  );
  requireKnown(isListed(statuses, search.statusId));
  requireKnown(
    isListed(
      await tasks.findMilestones(actor, [search.projectId]),
      search.milestoneId,
    ),
  );
  const tags = await tasks.findLabels();
  requireKnown((search.tagIds ?? []).every((tagId) => isListed(tags, tagId)));
}

/**
 * Turns the filters of a search into ticket query options.
 *
 * @param context - The services of the call, bound to the searching account.
 * @param directory - The people, groups and departments the account sees.
 * @param search - The validated filters.
 * @returns Query options without the project; the caller adds it.
 * @throws {AgentOperationError} `NOT_FOUND` for a status, milestone, department, person, group,
 * tag or parent ticket that does not exist or is hidden, `INVALID_REQUEST` for a parent of another project.
 *
 * @remarks
 * Every identifier is checked against what the account sees, so a filter
 * cannot be used to find out whether a hidden person or department exists.
 */
export async function resolveAgentTicketSearchFilters(
  context: AgentTaskContext,
  directory: AgentDirectory,
  search: AgentTicketSearchInput,
): Promise<FindWorkItemsOptions> {
  await requireKnownCatalogs(context, search);
  requireKnown(isListed(directory.departments, search.departmentId));
  requireKnown(isListed(directory.people, search.assigneeId));
  requireKnown(isListed(directory.groups, search.assigneeGroupId));
  const parent = search.parent
    ? await requireAgentTicket(context, search.parent)
    : null;
  if (parent !== null && parent.projectId !== search.projectId)
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    type: search.type,
    statusId: search.statusId,
    milestoneId: search.milestoneId,
    departmentId: search.departmentId,
    assigneeId: search.assigneeId,
    assigneeGroupId: search.assigneeGroupId,
    labelIds: search.tagIds,
    parentId: parent?.id,
    search: search.text,
    searchDescription: search.text !== undefined,
  };
}

/**
 * Cuts the part of a description around the first match of the searched text.
 *
 * @param description - The description of a ticket that matched.
 * @param text - The searched text, or `undefined` for a search without text.
 * @returns At most 200 characters around the match, or `null` when the
 * description does not contain the text, or there was no text.
 */
export function describeSearchMatch(
  description: string,
  text: string | undefined,
): string | null {
  if (text === undefined) return null;
  const index = description.toLowerCase().indexOf(text.toLowerCase());
  if (index < 0) return null;
  const characters = Array.from(description);
  const prefixLength = Array.from(description.slice(0, index)).length;
  const start = Math.max(0, prefixLength - Math.floor(SNIPPET_CHARACTERS / 4));
  return characters.slice(start, start + SNIPPET_CHARACTERS).join("");
}
