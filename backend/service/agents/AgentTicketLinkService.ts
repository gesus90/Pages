import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { pageAgentEntries } from "./AgentCursor";
import { createAgentReadContext, respondAgentRead } from "./AgentReadContext";
import { translateAgentTicketError } from "./AgentTicketErrors";
import { requireAgentTicket } from "./AgentTicketLookup";
import {
  readAgentTicketLinkAdd,
  readAgentTicketLinkRemove,
  readAgentTicketLinksRead,
} from "./AgentTicketNavigationValidation";

import type {
  AgentTicketLink,
  AgentTicketLinkAddInput,
  AgentTicketLinkChanged,
  AgentTicketLinkOperation,
  AgentTicketLinkRemoveInput,
} from "@/definition/AgentTicketNavigation";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { WorkItemDetail, WorkItemLink } from "@/definition/Task";
import type { AgentReadDependencies } from "./AgentReadContext";
import type { AgentTaskContext } from "./AgentTaskAccess";
import type { AgentTicketAnnouncer } from "./AgentTicketAnnouncer";
import type {
  AgentTicketCompleted,
  AgentTicketOutcome,
  AgentTicketTransaction,
} from "./AgentTicketTransaction";

/** The server-owned collaborators of link reads and changes. */
export interface AgentTicketLinkDependencies extends AgentReadDependencies {
  readonly transaction: AgentTicketTransaction;
  readonly announcer: AgentTicketAnnouncer;
}

function toLink(link: WorkItemLink): AgentTicketLink {
  return {
    id: link.id,
    linkType: link.linkType,
    direction: link.direction,
    ticket: {
      id: link.linkedWorkItemId,
      key: link.linkedWorkItemKey,
      title: link.linkedWorkItemTitle,
      statusKey: link.linkedWorkItemStatusKey,
      isDone: link.linkedWorkItemIsDone,
    },
    createdAt: link.createdAt,
  };
}

function toResult(
  ticket: WorkItemDetail,
  link: WorkItemLink,
  isRemoved: boolean,
): AgentTicketLinkChanged {
  return {
    linkId: link.id,
    linkType: link.linkType,
    direction: link.direction,
    ticketId: ticket.id,
    key: ticket.key,
    linkedTicketId: link.linkedWorkItemId,
    linkedKey: link.linkedWorkItemKey,
    removed: isRemoved,
  };
}

/** Whether the link already says what a new link of this type from the ticket to the target would say. */
function isDuplicate(
  link: WorkItemLink,
  targetId: string,
  linkType: WorkItemLink["linkType"],
): boolean {
  if (link.linkType !== linkType || link.linkedWorkItemId !== targetId)
    return false;
  // "Relates to" has no direction: the link from the other side is the same link.
  return link.direction === "outgoing" || linkType === "relates_to";
}

/** Reads and changes the typed links between tickets for an agent. */
export class AgentTicketLinkService {
  private readonly dependencies: AgentTicketLinkDependencies;

  public constructor(dependencies: AgentTicketLinkDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the visible links of one ticket.
   *
   * @param identity - The verified owner of the call.
   * @param parameters - The raw operation parameters: `ticketId`, `cursor` and `limit`.
   * @returns One page of links, each from the point of view of the ticket.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `NOT_FOUND` or `PAYLOAD_TOO_LARGE`.
   *
   * @remarks
   * A link whose other ticket the account cannot see is neither listed nor
   * counted. The same link shows on both tickets with the same `id`: `outgoing`
   * on the ticket it was created on, `incoming` on the other.
   */
  public async read(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse> {
    const request = readAgentTicketLinksRead(parameters);
    const context = await createAgentReadContext(this.dependencies, identity);
    try {
      const ticket = await requireAgentTicket(context, request.ticket);
      const links = await context.tasks.findLinks(context.actor, ticket.id);
      const page = pageAgentEntries(
        links.map((link) => ({ id: `${link.createdAt}:${link.id}`, link })),
        {
          ...request.window,
          context: JSON.stringify([
            identity.userId,
            "tickets.links.read",
            ticket.id,
          ]),
        },
      );
      return respondAgentRead({
        ticketId: ticket.id,
        key: ticket.key,
        links: page.entries.map(({ link }) => toLink(link)),
        total: page.total,
        nextCursor: page.nextCursor,
      });
    } catch (error: unknown) {
      throw translateAgentTicketError(error);
    }
  }

  /**
   * Adds or removes one link for the owner of a verified credential.
   *
   * @param identity - The verified owner of the operation.
   * @param operation - `tickets.link.add` or `tickets.link.remove`.
   * @param parameters - The raw operation parameters.
   * @returns The stored result; a repeated operation ID returns it unchanged.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `FORBIDDEN`, `NOT_FOUND` or `CONFLICT`.
   *
   * @remarks
   * Only the link changes: no parent, field or other link is touched. A
   * target the account cannot see is `NOT_FOUND`, like a missing one; a link
   * to the ticket itself or to an archived ticket is `INVALID_REQUEST`, a link
   * that already exists is `CONFLICT`.
   */
  public async apply(
    identity: AgentIdentity,
    operation: AgentTicketLinkOperation,
    parameters: unknown,
  ): Promise<PagesAgentWriteResponse> {
    const completed = await this.run(identity, operation, parameters);
    this.dependencies.announcer.announce(completed);
    return { apiVersion: "1", result: completed.result };
  }

  private async run(
    identity: AgentIdentity,
    operation: AgentTicketLinkOperation,
    parameters: unknown,
  ): Promise<AgentTicketCompleted<AgentTicketLinkChanged>> {
    if (operation === "tickets.link.add") {
      const request = readAgentTicketLinkAdd(parameters);
      return this.dependencies.transaction.run({
        userId: identity.userId,
        operation,
        request,
        needsWriteRight: true,
        revisit: (context, stored) => this.revisit(context, stored),
        work: (context) => this.add(context, request),
      });
    }
    const request = readAgentTicketLinkRemove(parameters);
    return this.dependencies.transaction.run({
      userId: identity.userId,
      operation,
      request,
      needsWriteRight: true,
      revisit: (context, stored) => this.revisit(context, stored),
      work: (context) => this.remove(context, request),
    });
  }

  /** Shows a stored result only while both tickets are still visible. */
  private async revisit(
    context: AgentTaskContext,
    stored: AgentTicketLinkChanged,
  ): Promise<void> {
    await context.tasks.getById(context.actor, stored.ticketId);
    await context.tasks.getById(context.actor, stored.linkedTicketId);
  }

  private async add(
    context: AgentTaskContext,
    request: AgentTicketLinkAddInput,
  ): Promise<AgentTicketOutcome<AgentTicketLinkChanged>> {
    const { actor, tasks } = context;
    const ticket = await requireAgentTicket(context, request.ticket);
    const target = await requireAgentTicket(context, request.target);
    if (ticket.archivedAt !== null) throw new AgentOperationError("CONFLICT");
    if (target.archivedAt !== null || target.id === ticket.id)
      throw new AgentOperationError("INVALID_REQUEST");
    const existing = await tasks.findLinks(actor, ticket.id);
    if (existing.some((link) => isDuplicate(link, target.id, request.linkType)))
      throw new AgentOperationError("CONFLICT");
    const links = await tasks.addLink(
      actor,
      ticket.id,
      target.key,
      request.linkType,
    );
    const created = links.find(
      (link) =>
        link.direction === "outgoing" &&
        link.linkedWorkItemId === target.id &&
        link.linkType === request.linkType,
    );
    if (!created) throw new AgentOperationError("CONFLICT");
    return {
      result: toResult(ticket, created, false),
      // GitHub does not learn of links, like when the ticket page changes them.
      published: null,
      event: { type: "ticket.updated", id: ticket.id },
    };
  }

  private async remove(
    context: AgentTaskContext,
    request: AgentTicketLinkRemoveInput,
  ): Promise<AgentTicketOutcome<AgentTicketLinkChanged>> {
    const { actor, tasks } = context;
    const ticket = await requireAgentTicket(context, request.ticket);
    if (ticket.archivedAt !== null) throw new AgentOperationError("CONFLICT");
    // Only a link the account can see on this ticket exists for it; any other ID is missing.
    const link = (await tasks.findLinks(actor, ticket.id)).find(
      ({ id }) => id === request.linkId,
    );
    if (!link) throw new AgentOperationError("NOT_FOUND");
    await tasks.removeLink(actor, ticket.id, link.id);
    return {
      result: toResult(ticket, link, true),
      published: null,
      event: { type: "ticket.updated", id: ticket.id },
    };
  }
}
