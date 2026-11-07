import { WORK_ITEM_TYPE } from "@/definition/Task";

import { McpTicketError } from "./McpTicketError";
import { currentTicket } from "./McpTicketProjection";

import type { ChildHandling, WorkItemDetail } from "@/definition/Task";
import type {
  McpTicket,
  McpTicketConfirmation,
  McpTicketReference,
} from "./McpTicketContract";
import type { McpTicketContext } from "./McpTicketContext";
import type { McpTicketLifecycleRequest } from "./McpTicketRequest";

/** Which descendants a preview walks: the active ones an archive reaches, or all a deletion reaches. */
type DescendantScope = "active" | "all";

function referenceOf(item: WorkItemDetail): McpTicketReference {
  return { key: item.key, title: item.title };
}

/**
 * Rejects `keep` for a task, whose subtasks always go along, like the archive
 * and the deletion do.
 *
 * @throws {McpTicketError} `invalid_request`.
 */
function requireHandling(
  ticket: WorkItemDetail,
  handling: ChildHandling,
): void {
  if (handling === "keep" && ticket.type === WORK_ITEM_TYPE.TASK)
    throw new McpTicketError("invalid_request");
}

/** Archives, restores and permanently deletes tickets (PAGE-242, interface 14–16). */
export class McpTicketLifecycleService {
  /**
   * Archives a ticket after the client confirmed the scope.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @param request - Handling of the children and the confirmation.
   * @returns The question with every ticket that would be archived, or the
   * number of newly archived tickets.
   * @throws {McpTicketError} `forbidden` without the archive right of the project.
   */
  public async archive(
    context: McpTicketContext,
    reference: string,
    request: McpTicketLifecycleRequest,
  ): Promise<McpTicketConfirmation | { readonly archived: number }> {
    const { actor, services } = context;
    const ticket = await context.ticket(reference);
    const handling = request.children ?? "include";
    const descendants = await services.tasks.describeDescendants(
      actor,
      ticket.id,
    );
    if (!descendants.canArchive) throw new McpTicketError("forbidden");
    if (request.confirmed !== true) {
      requireHandling(ticket, handling);
      const affected = await this.affected(context, ticket, handling, "active");
      return this.question(
        ticket,
        affected.filter((item) => item.archivedAt === null),
      );
    }
    return {
      archived: await services.tasks.archive(actor, ticket.id, handling),
    };
  }

  /**
   * Brings an archived ticket back with its subtasks; the status stays.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @returns The number of restored tickets and the ticket.
   * @throws {McpTicketError} `forbidden` without the archive right of the project.
   */
  public async restore(
    context: McpTicketContext,
    reference: string,
  ): Promise<{ readonly restored: number; readonly ticket: McpTicket }> {
    const { actor, services } = context;
    const ticket = await context.ticket(reference);
    await services.tasks.requireArchivableWorkItem(actor, ticket.id);
    const impact = await services.tasks.restoreWithImpact(actor, ticket.id);
    return {
      restored: impact.changedCount,
      ticket: await currentTicket(context, ticket.id),
    };
  }

  /**
   * Deletes a ticket for good after the client confirmed the scope; its
   * attachments go along.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket, running or archived.
   * @param request - Handling of the children and the confirmation.
   * @throws {McpTicketError} `forbidden` for an account that is no administrator.
   */
  public async delete(
    context: McpTicketContext,
    reference: string,
    request: McpTicketLifecycleRequest,
  ): Promise<McpTicketConfirmation | { readonly deleted: true }> {
    const { actor, services } = context;
    const ticket = await context.ticket(reference);
    const handling = request.children ?? "include";
    const { canDelete } = await services.tasks.actionPermissions(actor);
    if (!canDelete) throw new McpTicketError("forbidden");
    if (request.confirmed !== true) {
      requireHandling(ticket, handling);
      await services.tasks.describeDescendants(actor, ticket.id);
      return this.question(
        ticket,
        await this.affected(context, ticket, handling, "all"),
      );
    }
    await services.tasks.deletePermanently(actor, ticket.id, handling);
    return { deleted: true };
  }

  private question(
    ticket: WorkItemDetail,
    affected: readonly WorkItemDetail[],
  ): McpTicketConfirmation {
    return {
      confirmationRequired: true,
      ticket: referenceOf(ticket),
      affected: affected.map(referenceOf),
    };
  }

  /**
   * Lists the ticket and the descendants a change would reach.
   *
   * @remarks
   * With `keep` only the ticket itself changes; its direct children stay
   * without a parent.
   */
  private async affected(
    context: McpTicketContext,
    ticket: WorkItemDetail,
    handling: ChildHandling,
    scope: DescendantScope,
  ): Promise<WorkItemDetail[]> {
    const items = [ticket];
    if (handling === "keep") return items;
    for (let index = 0; index < items.length; index += 1) {
      const parent = items[index];
      if (parent === undefined) break;
      items.push(...(await this.children(context, parent, scope)));
    }
    return items;
  }

  /** Reads the visible direct children of a ticket in one scope. */
  private async children(
    context: McpTicketContext,
    parent: WorkItemDetail,
    scope: DescendantScope,
  ): Promise<WorkItemDetail[]> {
    return context.services.tasks.findAll(context.actor, {
      projectIds: [parent.projectId],
      parentId: parent.id,
      archived: scope,
    });
  }
}
