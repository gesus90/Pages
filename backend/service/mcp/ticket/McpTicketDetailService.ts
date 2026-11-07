import { requireActiveTicket } from "./McpTicketChange";
import { McpTicketError } from "./McpTicketError";
import { currentTicket, projectAttachment } from "./McpTicketProjection";

import type { OpenedTicketAttachment } from "@/backend/service/task/TaskAttachmentService";
import type { UploadedFile } from "@/backend/service/wiki/WikiAttachmentService";
import type { WorkItemDetail } from "@/definition/Task";
import type { McpTicket, McpTicketAttachment } from "./McpTicketContract";
import type { McpTicketContext } from "./McpTicketContext";
import type { McpTicketLinkRequest } from "./McpTicketRequest";

/** The answer of an upload: the new attachment and the ticket that carries it. */
export interface McpTicketUploadResult {
  readonly attachment: McpTicketAttachment;
  readonly ticket: McpTicket;
}

/** Acceptance criteria, links and attachments of tickets (PAGE-242, interface 9–11). */
export class McpTicketDetailService {
  /**
   * Appends an acceptance criterion to a ticket.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @param title - Title of the criterion.
   */
  public async addChecklistItem(
    context: McpTicketContext,
    reference: string,
    title: string,
  ): Promise<McpTicket> {
    const ticket = await context.ticket(reference);
    requireActiveTicket(ticket);
    await context.services.tasks.addChecklistItem(
      context.actor,
      ticket.id,
      title,
    );
    return currentTicket(context, ticket.id);
  }

  /**
   * Checks or reopens an acceptance criterion of a ticket.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @param itemId - A criterion of this very ticket.
   * @param isDone - The new state.
   */
  public async setChecklistItemDone(
    context: McpTicketContext,
    reference: string,
    itemId: string,
    isDone: boolean,
  ): Promise<McpTicket> {
    const ticket = await this.ticketWithChecklistItem(
      context,
      reference,
      itemId,
    );
    await context.services.tasks.setChecklistItemDone(
      context.actor,
      itemId,
      isDone,
    );
    return currentTicket(context, ticket.id);
  }

  /**
   * Deletes an acceptance criterion of a ticket.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @param itemId - A criterion of this very ticket.
   */
  public async deleteChecklistItem(
    context: McpTicketContext,
    reference: string,
    itemId: string,
  ): Promise<McpTicket> {
    const ticket = await this.ticketWithChecklistItem(
      context,
      reference,
      itemId,
    );
    await context.services.tasks.deleteChecklistItem(context.actor, itemId);
    return currentTicket(context, ticket.id);
  }

  /**
   * Links a ticket with another one; `blocks` and `duplicates` start at the ticket.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @param request - Type of the link and key of the other ticket.
   * @throws {McpTicketError} `invalid_request` for a link that exists already
   * or a link of a ticket with itself.
   */
  public async addLink(
    context: McpTicketContext,
    reference: string,
    request: McpTicketLinkRequest,
  ): Promise<McpTicket> {
    const { actor, services } = context;
    const ticket = await context.ticket(reference);
    requireActiveTicket(ticket);
    const target = request.target.trim().toUpperCase();
    const links = await services.tasks.findLinks(actor, ticket.id);
    // The store keeps one row per direction and quietly ignores a repetition;
    // the interface names it, and a relation without direction exists once.
    const isDuplicate = links.some(
      (link) =>
        link.linkType === request.type &&
        link.linkedWorkItemKey.toUpperCase() === target &&
        (link.direction === "outgoing" || request.type === "relates_to"),
    );
    if (isDuplicate) throw new McpTicketError("invalid_request");
    await services.tasks.addLink(actor, ticket.id, target, request.type);
    return currentTicket(context, ticket.id);
  }

  /**
   * Removes a link of a ticket.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @param linkId - A visible link of this very ticket.
   */
  public async removeLink(
    context: McpTicketContext,
    reference: string,
    linkId: string,
  ): Promise<McpTicket> {
    const { actor, services } = context;
    const ticket = await context.ticket(reference);
    requireActiveTicket(ticket);
    const links = await services.tasks.findLinks(actor, ticket.id);
    if (!links.some((link) => link.id === linkId))
      throw new McpTicketError("not_found");
    await services.tasks.removeLink(actor, ticket.id, linkId);
    return currentTicket(context, ticket.id);
  }

  /**
   * Stores a file for a ticket with the limits of the instance.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @param file - The streamed body of the request.
   * @throws {McpTicketError} `too_large` above the limit of the instance.
   */
  public async upload(
    context: McpTicketContext,
    reference: string,
    file: UploadedFile,
  ): Promise<McpTicketUploadResult> {
    const ticket = await context.ticket(reference);
    const attachment = await context.services.attachments.upload(
      context.actor,
      ticket.id,
      file,
    );
    return {
      attachment: projectAttachment(attachment),
      ticket: await currentTicket(context, ticket.id),
    };
  }

  /**
   * Opens an attachment of a ticket with the checks of the interface.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @param attachmentId - An attachment of this very ticket.
   */
  public async open(
    context: McpTicketContext,
    reference: string,
    attachmentId: string,
  ): Promise<OpenedTicketAttachment> {
    await this.ticketWithAttachment(context, reference, attachmentId);
    return context.services.attachments.open(context.actor, attachmentId);
  }

  /**
   * Removes an attachment of a ticket.
   *
   * @param context - The request.
   * @param reference - Key or id of the ticket.
   * @param attachmentId - An attachment of this very ticket.
   */
  public async removeAttachment(
    context: McpTicketContext,
    reference: string,
    attachmentId: string,
  ): Promise<McpTicket> {
    const ticket = await this.ticketWithAttachment(
      context,
      reference,
      attachmentId,
    );
    await context.services.attachments.remove(context.actor, attachmentId);
    return currentTicket(context, ticket.id);
  }

  /** Reads a ticket and checks that the criterion belongs to it. */
  private async ticketWithChecklistItem(
    context: McpTicketContext,
    reference: string,
    itemId: string,
  ): Promise<WorkItemDetail> {
    const ticket = await context.ticket(reference);
    requireActiveTicket(ticket);
    const items = await context.services.tasks.findChecklistItems(
      context.actor,
      ticket.id,
    );
    if (!items.some((item) => item.id === itemId))
      throw new McpTicketError("not_found");
    return ticket;
  }

  /** Reads a ticket and checks that the attachment belongs to it. */
  private async ticketWithAttachment(
    context: McpTicketContext,
    reference: string,
    attachmentId: string,
  ): Promise<WorkItemDetail> {
    const ticket = await context.ticket(reference);
    const attachments = await context.services.attachments.list(
      context.actor,
      ticket.id,
    );
    if (!attachments.some((attachment) => attachment.id === attachmentId))
      throw new McpTicketError("not_found");
    return ticket;
  }
}
