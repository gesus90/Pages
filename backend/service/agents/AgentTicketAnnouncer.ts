import type { ServerCache } from "@/backend/cache/ServerCache";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";
import type { AgentTicketCompleted } from "./AgentTicketTransaction";

/** Publishes a changed ticket to GitHub on the rule of Pages; nothing is forced. */
export interface AgentTicketPublisher {
  readonly publish: (actor: User, item: WorkItemDetail) => Promise<void>;
}

/** The server-owned collaborators that react to a committed change. */
export interface AgentTicketAnnouncerDependencies {
  readonly events: PagesEventPublisher;
  readonly cache: Pick<ServerCache, "invalidateWorkItems">;
  /** `null` when GitHub synchronization is not part of this process. */
  readonly publisher: AgentTicketPublisher | null;
}

/**
 * Tells everything that depends on tickets about a change that has been committed.
 *
 * @remarks
 * Nothing here runs before the commit, so a rolled back call is never
 * announced and never published. GitHub follows the Pages setting of the
 * project: the publisher is the one the ticket pages use, and it decides
 * whether the project is synchronized at all.
 */
export class AgentTicketAnnouncer {
  private readonly dependencies: AgentTicketAnnouncerDependencies;

  public constructor(dependencies: AgentTicketAnnouncerDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reacts to a completed call; a repeated call or one that wrote nothing is silent.
   *
   * @param completed - The outcome of the committed transaction.
   */
  public announce(completed: AgentTicketCompleted<unknown>): void {
    if (completed.event === null) return;
    this.dependencies.cache.invalidateWorkItems();
    if (completed.published !== null && this.dependencies.publisher)
      // The publisher records its own failures and never fails the change.
      void this.dependencies.publisher.publish(
        completed.actor,
        completed.published,
      );
    this.dependencies.events.publish(completed.event);
  }
}
