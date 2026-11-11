import type { DatabaseTransaction } from "@/backend/database/Database";

/** One event as the outbox stores it: kind and object, never content. */
export interface PagesEventRecord {
  readonly type: string;
  readonly id: string;
  /** Project and department of a deleted ticket; absent for every other event. */
  readonly audience?: {
    readonly projectId: string;
    readonly departmentIds: readonly string[];
  };
}

/**
 * Appends events in the transaction of the change they announce.
 *
 * @remarks
 * The insert takes the outbox lock of migration 015 until the transaction
 * ends, so positions become visible in commit order. A rollback removes the
 * event together with the change.
 */
export class PagesEventOutboxRepository {
  private readonly transaction: Pick<DatabaseTransaction, "execute">;

  /**
   * Binds the repository to an open transaction.
   *
   * @param transaction - The transaction of the business change.
   */
  public constructor(transaction: Pick<DatabaseTransaction, "execute">) {
    this.transaction = transaction;
  }

  /**
   * Stores one event in the open transaction.
   *
   * @param event - Kind, object and, for a deleted ticket, its audience.
   */
  public async append(event: PagesEventRecord): Promise<void> {
    await this.transaction.execute(
      `
        INSERT INTO pages_event_outbox (
            kind,
            object_id,
            audience_project_id,
            audience_department_ids
        )
        VALUES (
            $kind,
            $object_id,
            $audience_project_id,
            $audience_department_ids
        );
      `,
      {
        kind: event.type,
        object_id: event.id,
        audience_project_id: event.audience?.projectId ?? null,
        audience_department_ids: JSON.stringify(
          event.audience?.departmentIds ?? [],
        ),
      },
    );
  }
}
