import type { AgentTicketReference } from "@/definition/AgentTickets";
import type { WorkItemDetail } from "@/definition/Task";
import type { AgentTaskContext } from "./AgentTaskAccess";

/**
 * Reads the visible ticket a reference names.
 *
 * @param context - The services of the call, bound to the acting account.
 * @param reference - The identifier or key of the ticket.
 * @returns The ticket, archived ones included.
 * @throws {WorkItemNotFoundError} When the ticket does not exist or is hidden from the account.
 */
export async function requireAgentTicket(
  context: AgentTaskContext,
  reference: AgentTicketReference,
): Promise<WorkItemDetail> {
  return "id" in reference
    ? context.tasks.getById(context.actor, reference.id)
    : context.tasks.getByKey(context.actor, reference.key);
}

/**
 * Builds the Pages address of a ticket.
 *
 * @param key - The key of the ticket, such as `PAGE-12`.
 * @returns The address below the server.
 */
export function agentTicketLink(key: string): string {
  return `/tasks/${key}`;
}

/**
 * Builds a cursor-safe identifier that orders tickets by their number.
 *
 * @param ticket - The ticket to identify.
 * @returns A text that sorts by ticket number and stays unique within a project.
 */
export function agentTicketCursorId(
  ticket: Pick<WorkItemDetail, "id" | "number">,
): string {
  return `${String(ticket.number).padStart(10, "0")}:${ticket.id}`;
}
