import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { logCaughtError } from "@/backend/logging/Logger";

import { pageAgentEntries } from "./AgentCursor";
import { createAgentReadContext, respondAgentRead } from "./AgentReadContext";
import { translateAgentTicketError } from "./AgentTicketErrors";
import {
  agentTicketCursorId,
  agentTicketLink,
  requireAgentTicket,
} from "./AgentTicketLookup";
import { readAgentTicketTree } from "./AgentTicketNavigationValidation";

import type { AgentTicketNode } from "@/definition/AgentTicketNavigation";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { WorkItemDetail } from "@/definition/Task";
import type { AgentReadDependencies } from "./AgentReadContext";

/** The visible active tickets of a project, by identifier and by parent. */
interface TicketIndex {
  readonly byId: ReadonlyMap<string, WorkItemDetail>;
  readonly childrenByParent: ReadonlyMap<string, readonly WorkItemDetail[]>;
}

function indexTickets(tickets: readonly WorkItemDetail[]): TicketIndex {
  const childrenByParent = new Map<string, WorkItemDetail[]>();
  for (const ticket of tickets)
    if (ticket.parentId !== null)
      childrenByParent.set(ticket.parentId, [
        ...(childrenByParent.get(ticket.parentId) ?? []),
        ticket,
      ]);
  return {
    byId: new Map(tickets.map((ticket) => [ticket.id, ticket])),
    childrenByParent,
  };
}

function toNode(
  ticket: WorkItemDetail,
  index: TicketIndex,
  depth: number,
): AgentTicketNode {
  return {
    id: ticket.id,
    key: ticket.key,
    link: agentTicketLink(ticket.key),
    type: ticket.type,
    title: ticket.title,
    statusId: ticket.statusId,
    statusName: ticket.statusName,
    isDone: ticket.isDone,
    parentId: ticket.parentId,
    parentKey: ticket.parentKey,
    childCount: index.childrenByParent.get(ticket.id)?.length ?? 0,
    depth,
  };
}

/** The visible ancestors of a ticket, outermost first; the chain ends at the first one that is hidden. */
function ancestorsOf(
  ticket: WorkItemDetail,
  index: TicketIndex,
): WorkItemDetail[] {
  const ancestors: WorkItemDetail[] = [];
  const seen = new Set([ticket.id]);
  let parent = index.byId.get(ticket.parentId ?? "");
  while (parent !== undefined && !seen.has(parent.id)) {
    ancestors.unshift(parent);
    seen.add(parent.id);
    parent = index.byId.get(parent.parentId ?? "");
  }
  return ancestors;
}

/** A ticket with the number of visible ancestors it has. */
interface LeveledTicket {
  readonly ticket: WorkItemDetail;
  readonly depth: number;
}

/** Every visible descendant of a ticket with its level, parents before their children. */
function descendantsOf(
  root: LeveledTicket,
  index: TicketIndex,
): LeveledTicket[] {
  const found: LeveledTicket[] = [];
  const seen = new Set([root.ticket.id]);
  const queue = [root];
  for (let next = queue.shift(); next !== undefined; next = queue.shift())
    for (const child of index.childrenByParent.get(next.ticket.id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      const entry = { ticket: child, depth: next.depth + 1 };
      found.push(entry);
      queue.push(entry);
    }
  return found;
}

/** Reads the visible ticket hierarchy for an agent, within the scope of its account. */
export class AgentTicketTreeService {
  private readonly dependencies: AgentReadDependencies;

  public constructor(dependencies: AgentReadDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the hierarchy of a project, or the path and subtree of one ticket.
   *
   * @param identity - The verified owner of the call.
   * @param parameters - The raw operation parameters: `projectId` and/or `ticketId`, `cursor` and `limit`.
   * @returns The requested ticket with its visible ancestors, and one page of nodes.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `NOT_FOUND` or `PAYLOAD_TOO_LARGE`.
   *
   * @remarks
   * Only visible active tickets appear, with their counts. A parent the
   * account cannot see reads as no parent, and the path ends there. Nodes are
   * ordered by ticket number; `parentId` and `depth` rebuild the tree.
   */
  public async read(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse> {
    const request = readAgentTicketTree(parameters);
    const context = await createAgentReadContext(this.dependencies, identity);
    try {
      const root = request.ticket
        ? await requireAgentTicket(context, request.ticket)
        : null;
      const projectId = root?.projectId ?? request.projectId;
      // A project and a ticket that disagree name two different scopes.
      if (
        projectId === null ||
        (request.projectId !== null && request.projectId !== projectId)
      )
        throw new AgentOperationError("INVALID_REQUEST");
      if (root === null)
        await context.projects.getById(context.actor, projectId);
      const index = indexTickets(
        await context.tasks.findAll(context.actor, {
          projectIds: [projectId],
        }),
      );
      const path = root ? ancestorsOf(root, index) : [];
      const entries = root
        ? descendantsOf({ ticket: root, depth: path.length }, index)
        : [...index.byId.values()].map((ticket) => ({
            ticket,
            depth: ancestorsOf(ticket, index).length,
          }));
      const page = pageAgentEntries(
        entries.map((entry) => ({
          id: agentTicketCursorId(entry.ticket),
          entry,
        })),
        {
          ...request.window,
          context: JSON.stringify([
            identity.userId,
            "tickets.tree.read",
            projectId,
            root?.id ?? null,
          ]),
        },
      );
      return respondAgentRead({
        projectId,
        root: root ? toNode(root, index, path.length) : null,
        path: path.map((ticket, level) => toNode(ticket, index, level)),
        nodes: page.entries.map(({ entry }) =>
          toNode(entry.ticket, index, entry.depth),
        ),
        total: page.total,
        nextCursor: page.nextCursor,
      });
    } catch (error: unknown) {
      logCaughtError("AgentTicketTreeService", error);

      throw translateAgentTicketError(error);
    }
  }
}
