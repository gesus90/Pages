import type {
  PagesEvent,
  PagesEventPublisher,
} from "@/backend/service/events/PagesEventPublisher";

/** Runs a local GitHub change of Pages data as one transaction with its event. */
export type GitHubChangeEvents = Pick<PagesEventPublisher, "announce">;

/** A local change consists of writes only, so it takes the writer at its first one. */
const OPENS_AT_FIRST_WRITE = { opensAtFirstWrite: true } as const;

/**
 * Applies what GitHub said about one ticket as one transaction with its event.
 *
 * @param events - Runs the change and stores its event with it.
 * @param ticketId - The ticket the change belongs to.
 * @param work - Local writes only; every network call happens before.
 * @returns Whatever `work` returns.
 *
 * @remarks
 * The ticket, its history and its GitHub link commit together with one
 * `ticket.changed`, so a reader never sees the event before the final state
 * and a failing change leaves neither. The writer is held only for the local
 * writes, never across a GitHub request.
 */
export async function applyTicketChange<Result>(
  events: GitHubChangeEvents,
  ticketId: string,
  work: () => Promise<Result>,
): Promise<Result> {
  return events.announce(
    work,
    (): PagesEvent[] => [{ type: "ticket.changed", id: ticketId }],
    OPENS_AT_FIRST_WRITE,
  );
}

/**
 * Applies what GitHub said about a project's detected issues or pull requests
 * as one transaction with one `project.tickets.changed`.
 *
 * @param events - Runs the change and stores its event with it.
 * @param projectId - The project the change belongs to.
 * @param work - Local writes only; answers whether a statement inserted or
 * changed a row, from the rows the statements returned.
 * @returns Whether the list changed.
 *
 * @remarks
 * An upsert that finds its row unchanged still locks it, so the transaction
 * is no proof of a change; the answer of `work` is. One event stands for the
 * whole list, however many entries changed; an unchanged list has none.
 */
export async function applyProjectChange(
  events: GitHubChangeEvents,
  projectId: string,
  work: () => Promise<boolean>,
): Promise<boolean> {
  return events.announce(
    work,
    (isChanged): PagesEvent[] =>
      isChanged ? [{ type: "project.tickets.changed", id: projectId }] : [],
    // Taken at the start, so the reads that decide what to write see the state they change.
    { decidesChange: true },
  );
}
