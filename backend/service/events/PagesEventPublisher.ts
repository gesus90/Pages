import {
  afterCallCommit,
  hasChangedRows,
} from "@/backend/database/CallTransaction";
import { PagesEventOutboxRepository } from "@/backend/database/repositories/events/PagesEventOutboxRepository";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";

import type {
  CallOptions,
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

/** Where a deleted ticket was visible, because its row no longer answers that. */
export interface PagesEventAudience {
  readonly projectId: string;
  /** Empty when the ticket belonged to no department and was visible project-wide. */
  readonly departmentIds: readonly string[];
}

/** Every kind of Pages event, as the outbox stores it in `kind`. */
const PAGES_EVENT_TYPES = [
  "wiki.page.created",
  "wiki.page.updated",
  "wiki.comments.changed",
  "wiki.page.purged",
  "asset.linked",
  "ticket.created",
  "ticket.updated",
  "ticket.changed",
  "ticket.deleted",
  "milestone.created",
  "milestone.updated",
  "milestone.changed",
  "project.tickets.changed",
  "project.access.changed",
  "conversation.changed",
] as const;

const PAGES_EVENT_TYPE_SET: ReadonlySet<string> = new Set(PAGES_EVENT_TYPES);

/**
 * Tells whether an outbox `kind` is a Pages event this version knows.
 *
 * @param kind - The stored kind, such as `ticket.updated`.
 * @returns `false` for a kind of another version, which decides nothing.
 */
export function isPagesEventType(kind: string): kind is PagesEvent["type"] {
  return PAGES_EVENT_TYPE_SET.has(kind);
}

/**
 * Internal post-commit notification; content and user metadata never enter events.
 *
 * @remarks
 * `ticket.changed`, `ticket.deleted` and `milestone.changed` only tell the
 * live view that something changed: an archive, a restore, a deletion, a
 * reordering. `project.tickets.changed` names a project whose tickets a
 * GitHub synchronization changed. `wiki.page.purged` names a page removed
 * from the trash for good, `project.access.changed` a project whose
 * departments changed or that was archived or deleted.
 * `conversation.changed` names a conversation that got a message, a text of
 * a voice message or a member (PAGE-278); only its members hear of it.
 * Whoever lost the
 * object can no longer be asked whether they saw it, so the live view lets
 * every open page read again instead of naming it.
 * None of them names a field a Discord message states, so Discord leaves
 * them out.
 */
export interface PagesEvent {
  readonly type: (typeof PAGES_EVENT_TYPES)[number];
  readonly id: string;
  /** Set only on `ticket.deleted`; decides delivery and is never delivered. */
  readonly audience?: PagesEventAudience;
}

/** When an announced change takes the writer and how its events are decided. */
export interface AnnounceOptions extends CallOptions {
  /**
   * The result of the change itself tells whether anything changed, from the
   * rows its statements returned; `decide` then answers no event for a change
   * that changed nothing, even when the transaction locked rows.
   */
  readonly decidesChange?: boolean;
}

/**
 * Raised when a call changed rows but could not name the object of its event.
 *
 * @remarks
 * The change rolls back instead of committing without its event.
 */
export class PagesEventIdentityError extends Error {
  public constructor() {
    super("A committed change needs the object of its Pages event.");
    this.name = "PagesEventIdentityError";
  }
}

/**
 * Stores an event in the outbox of an open business transaction.
 *
 * @param transaction - The transaction that writes the change.
 * @param event - The event of the change; it commits or rolls back with it.
 */
export async function recordPagesEvent(
  transaction: Pick<DatabaseTransaction, "execute">,
  event: PagesEvent,
): Promise<void> {
  await new PagesEventOutboxRepository(transaction).append(event);
}

/**
 * Delivers internal events without allowing a subscriber to undo a committed write.
 *
 * @remarks
 * The durable copy of an event is its outbox row, written in the transaction
 * of the change: by {@link announce} for calls of the interface services and
 * by {@link recordPagesEvent} for callers that hold a transaction. Subscribers
 * of the process still hear it here after the commit, until `pages-core`
 * takes over the delivery.
 */
export class PagesEventPublisher {
  private readonly listeners = new Set<(event: PagesEvent) => void>();
  private readonly database: Pick<Database, "runCall"> | null;

  /**
   * Creates the publisher of one process.
   *
   * @param database - Runs announced calls; without it only the delivery in the process exists.
   */
  public constructor(database: Pick<Database, "runCall"> | null = null) {
    this.database = database;
  }

  /**
   * Runs a change as one transaction and stores its events with it.
   *
   * @param work - The change, possibly several statements and nested transactions.
   * @param decide - Names the events of the change from its result.
   * @param options - When the change takes the writer and whether its result decides the change.
   * @returns Whatever `work` returns, once the change and its events committed.
   * @throws {PagesEventIdentityError} When rows changed but `decide` named no event,
   * unless the result decides the change.
   *
   * @remarks
   * Every statement of the call after its opening joins one transaction, so a
   * reader of the outbox sees the event only together with the final state of
   * the change, and a failing call leaves neither. Only a call whose
   * transaction changed a row has events: a conditional write that matched
   * nothing, a replay or a call that writes nothing stores none and announces
   * none. Subscribers of the process hear the same events after the commit.
   * A transaction id is no row count: a row lock, such as the one of a skipped
   * `ON CONFLICT DO UPDATE`, assigns one as well, so a change whose statements
   * can lock without changing decides from the rows they returned
   * (`decidesChange`).
   */
  public async announce<Result>(
    work: () => Promise<Result>,
    decide: (result: Result) => readonly PagesEvent[],
    options: AnnounceOptions = {},
  ): Promise<Result> {
    if (!this.database)
      throw new Error("Announced changes need the database of the process.");
    return this.database.runCall(
      work,
      async ({ transaction, result, isNested }) => {
        if (!(await hasChangedRows(transaction))) return;
        const events = decide(result);
        if (events.length === 0 && !isNested && !options.decidesChange)
          throw new PagesEventIdentityError();
        for (const event of events) await recordPagesEvent(transaction, event);
        await afterCallCommit(async () => {
          for (const event of events) this.publish(event);
        });
      },
      options,
    );
  }

  /** Registers one process-local subscriber and returns its release function. */
  public subscribe(listener: (event: PagesEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Emits only after the database transaction has committed. */
  public publish(event: PagesEvent): void {
    logEvent({
      level: "info",
      event: event.type,
      component: "PagesEventPublisher",
      message: "Business change committed",
      metadata: { eventType: event.type },
    });
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (caughtError: unknown) {
        logCaughtError("PagesEventPublisher", caughtError);

        logDiagnostic(
          "PagesEventPublisher",
          "warn",
          "Pages event subscriber failed.",
        );
      }
    }
  }
}
