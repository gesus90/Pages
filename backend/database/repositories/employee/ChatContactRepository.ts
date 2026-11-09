import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** One entry of a person's participant list. */
export interface ChatContactEntry {
  readonly contactId: string;
  /** ISO time of the adding or the last sent message. */
  readonly lastActivityAt: string;
}

/**
 * The people and agents a person keeps in the participant list of the chat
 * (PAGE-266, PAGE-259).
 *
 * @remarks
 * A contact is only an entry of the person's own list: removing it deletes
 * neither an account nor an agent. Every statement is bound to the owner, so
 * an ID of another person's list never matches.
 */
export class ChatContactRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;

  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
  }

  /** Returns a person's list, the latest activity first. */
  public async list(ownerId: string): Promise<ChatContactEntry[]> {
    const rows = await this.database.query(
      `
        SELECT
            contact_id,
            last_activity_at
        FROM chat_contacts
        WHERE owner_id = $owner_id
        ORDER BY last_activity_at DESC, contact_id;
      `,
      { owner_id: ownerId },
    );
    return rows.map((row) => ({
      contactId: readTextColumn(row, 0, "contact_id"),
      lastActivityAt: readTextColumn(row, 1, "last_activity_at"),
    }));
  }

  /**
   * Replaces a person's list: missing IDs are removed, kept ones keep their
   * activity, and new ones are added with the given times.
   *
   * @param ownerId - The person whose list changes.
   * @param additions - Activity time of every new ID, by ID.
   * @param keptIds - The IDs that stay in the list.
   */
  public async replace(
    ownerId: string,
    additions: ReadonlyMap<string, string>,
    keptIds: readonly string[],
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const wanted = new Set([...keptIds, ...additions.keys()]);
      const current = (
        await transaction.query(
          `
            SELECT contact_id
            FROM chat_contacts
            WHERE owner_id = $owner_id;
          `,
          { owner_id: ownerId },
        )
      ).map((row) => readTextColumn(row, 0, "contact_id"));
      for (const contactId of current.filter((id) => !wanted.has(id)))
        await transaction.execute(
          `
            DELETE FROM chat_contacts
            WHERE owner_id = $owner_id
                AND contact_id = $contact_id;
          `,
          { owner_id: ownerId, contact_id: contactId },
        );
      for (const [contactId, addedAt] of additions)
        await transaction.execute(
          `
            INSERT INTO chat_contacts (
                owner_id,
                contact_id,
                last_activity_at
            )
            VALUES (
                $owner_id,
                $contact_id,
                $last_activity_at
            )
            ON CONFLICT (owner_id, contact_id) DO NOTHING;
          `,
          {
            owner_id: ownerId,
            contact_id: contactId,
            last_activity_at: addedAt,
          },
        );
    });
  }

  /**
   * Records a sent message as the last activity of an entry.
   *
   * @returns Whether the entry is in the person's list.
   */
  public async touch(
    ownerId: string,
    contactId: string,
    activityAt: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE chat_contacts
        SET last_activity_at = $last_activity_at
        WHERE owner_id = $owner_id
            AND contact_id = $contact_id
        RETURNING contact_id;
      `,
      {
        owner_id: ownerId,
        contact_id: contactId,
        last_activity_at: activityAt,
      },
    );
    return rows.length > 0;
  }
}
