import { pageAgentEntries } from "./AgentCursor";
import { readAgentDirectory } from "./AgentDirectoryService";
import { readAgentTicketTags } from "./AgentPlanningEnrichment";
import { createAgentReadContext, respondAgentRead } from "./AgentReadContext";
import { translateAgentTicketError } from "./AgentTicketErrors";
import { agentTicketCursorId, agentTicketLink } from "./AgentTicketLookup";
import { readAgentTicketSearch } from "./AgentTicketNavigationValidation";
import {
  describeSearchMatch,
  resolveAgentTicketSearchFilters,
} from "./AgentTicketSearchFilters";

import type { AgentTag } from "@/definition/AgentExtensions";
import type { AgentTicketSummary } from "@/definition/AgentTicketNavigation";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { WorkItemDetail } from "@/definition/Task";
import type { AgentDirectory } from "./AgentDirectoryService";
import type { AgentReadDependencies } from "./AgentReadContext";

function summarize(
  ticket: WorkItemDetail,
  directory: AgentDirectory,
  tags: readonly AgentTag[],
  text: string | undefined,
): AgentTicketSummary {
  const group = directory.groups.find(
    ({ id }) => id === ticket.assigneeGroupId,
  );
  return {
    id: ticket.id,
    key: ticket.key,
    link: agentTicketLink(ticket.key),
    projectId: ticket.projectId,
    type: ticket.type,
    title: ticket.title,
    priority: ticket.priority,
    statusId: ticket.statusId,
    statusName: ticket.statusName,
    isDone: ticket.isDone,
    parentId: ticket.parentId,
    parentKey: ticket.parentKey,
    milestoneId: ticket.milestoneId,
    milestoneName: ticket.milestoneName,
    assignee:
      directory.people.find(({ id }) => id === ticket.assigneeId) ?? null,
    assigneeGroup: group ? { id: group.id, name: group.name } : null,
    department:
      directory.departments.find(({ id }) => id === ticket.departmentId) ??
      null,
    tags,
    snippet: describeSearchMatch(ticket.description, text),
  };
}

/** Finds the tickets of a project by text and filters for an agent, within the scope of its account. */
export class AgentTicketSearchService {
  private readonly dependencies: AgentReadDependencies;

  public constructor(dependencies: AgentReadDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Searches the visible active tickets of one project.
   *
   * @param identity - The verified owner of the call.
   * @param parameters - The raw operation parameters: `projectId`, optional filters, `cursor` and `limit`.
   * @returns One page of matching tickets with the number of all visible matches.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `NOT_FOUND` or `PAYLOAD_TOO_LARGE`.
   *
   * @remarks
   * The text matches key, title and description. Hidden tickets are neither
   * listed nor counted, and every filter value must be something the account
   * sees. Tickets are ordered by number, so a cursor never repeats or skips a
   * visible match, also when tickets are added between two pages.
   */
  public async search(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse> {
    const { search, window } = readAgentTicketSearch(parameters);
    const context = await createAgentReadContext(this.dependencies, identity);
    try {
      await context.projects.getById(context.actor, search.projectId);
      const directory = await readAgentDirectory(context);
      const filters = await resolveAgentTicketSearchFilters(
        context,
        directory,
        search,
      );
      const tickets = await context.tasks.findAll(context.actor, {
        ...filters,
        projectIds: [search.projectId],
      });
      const page = pageAgentEntries(
        tickets.map((ticket) => ({ id: agentTicketCursorId(ticket), ticket })),
        {
          ...window,
          context: JSON.stringify([identity.userId, "tickets.search", search]),
        },
      );
      const tags = await readAgentTicketTags(
        context,
        page.entries.map(({ ticket }) => ticket.id),
      );
      return respondAgentRead({
        projectId: search.projectId,
        tickets: page.entries.map(({ ticket }) =>
          summarize(ticket, directory, tags.get(ticket.id) ?? [], search.text),
        ),
        total: page.total,
        nextCursor: page.nextCursor,
      });
    } catch (error: unknown) {
      throw translateAgentTicketError(error);
    }
  }
}
