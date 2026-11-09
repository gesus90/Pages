import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** Adds one participant to a group; a second add changes nothing. */
const INSERT_MEMBER = `
  INSERT INTO chat_group_members (
      group_id,
      owner_id,
      contact_id,
      added_at
  )
  VALUES (
      $group_id,
      $owner_id,
      $contact_id,
      $added_at
  )
  ON CONFLICT (group_id, contact_id) DO NOTHING;
`;

/** A stored group of a person's chat page with its members. */
export interface ChatGroupRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** ISO time of the creation or the last sent message. */
  readonly lastActivityAt: string;
  /** Participant IDs in the order they joined. */
  readonly memberIds: readonly string[];
}

/** What a new group is stored with. */
export interface NewChatGroup {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly memberIds: readonly string[];
  readonly createdAt: string;
}

type GroupDatabase = Pick<Database, "query" | "execute" | "transaction">;

/**
 * The groups of the chat page (PAGE-259), each owned by one account.
 *
 * @remarks
 * Every statement is bound to the owner, so a group or participant ID of
 * another account never matches. Members are entries of the owner's own
 * participant list; the schema refuses any other.
 */
export class ChatGroupRepository {
  private readonly database: GroupDatabase;

  public constructor(database: GroupDatabase) {
    this.database = database;
  }

  /** Returns a person's groups, the latest activity first. */
  public async list(ownerId: string): Promise<ChatGroupRecord[]> {
    const [groupRows, memberRows] = await Promise.all([
      this.database.query(
        `
          SELECT
              id,
              name,
              description,
              last_activity_at
          FROM chat_groups
          WHERE owner_id = $owner_id
          ORDER BY last_activity_at DESC, id;
        `,
        { owner_id: ownerId },
      ),
      this.database.query(
        `
          SELECT
              group_id,
              contact_id
          FROM chat_group_members
          WHERE owner_id = $owner_id
          ORDER BY added_at, contact_id;
        `,
        { owner_id: ownerId },
      ),
    ]);
    const members = new Map<string, string[]>();
    for (const row of memberRows) {
      const groupId = readTextColumn(row, 0, "group_id");
      const list = members.get(groupId) ?? [];
      list.push(readTextColumn(row, 1, "contact_id"));
      members.set(groupId, list);
    }
    return groupRows.map((row) => {
      const id = readTextColumn(row, 0, "id");
      return {
        id,
        name: readTextColumn(row, 1, "name"),
        description: readTextColumn(row, 2, "description"),
        lastActivityAt: readTextColumn(row, 3, "last_activity_at"),
        memberIds: members.get(id) ?? [],
      };
    });
  }

  /** Returns the member IDs of a person's group, or `null` for no such group. */
  public async memberIds(
    ownerId: string,
    groupId: string,
  ): Promise<string[] | null> {
    const groups = await this.database.query(
      `
        SELECT id
        FROM chat_groups
        WHERE owner_id = $owner_id
            AND id = $group_id;
      `,
      { owner_id: ownerId, group_id: groupId },
    );
    if (groups.length === 0) return null;
    const rows = await this.database.query(
      `
        SELECT contact_id
        FROM chat_group_members
        WHERE owner_id = $owner_id
            AND group_id = $group_id;
      `,
      { owner_id: ownerId, group_id: groupId },
    );
    return rows.map((row) => readTextColumn(row, 0, "contact_id"));
  }

  /** Stores a new group of a person with its first members. */
  public async create(ownerId: string, group: NewChatGroup): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          INSERT INTO chat_groups (
              id,
              owner_id,
              name,
              description,
              last_activity_at
          )
          VALUES (
              $id,
              $owner_id,
              $name,
              $description,
              $last_activity_at
          );
        `,
        {
          id: group.id,
          owner_id: ownerId,
          name: group.name,
          description: group.description,
          last_activity_at: group.createdAt,
        },
      );
      for (const contactId of group.memberIds)
        await transaction.execute(INSERT_MEMBER, {
          group_id: group.id,
          owner_id: ownerId,
          contact_id: contactId,
          added_at: group.createdAt,
        });
    });
  }

  /** Adds a participant of the owner's list to one of the owner's groups. */
  public async addMember(
    ownerId: string,
    groupId: string,
    contactId: string,
    addedAt: string,
  ): Promise<void> {
    await this.database.execute(INSERT_MEMBER, {
      group_id: groupId,
      owner_id: ownerId,
      contact_id: contactId,
      added_at: addedAt,
    });
  }

  /**
   * Records a sent message as the last activity of a group.
   *
   * @returns Whether the group belongs to the person.
   */
  public async touch(
    ownerId: string,
    groupId: string,
    activityAt: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE chat_groups
        SET last_activity_at = $last_activity_at
        WHERE owner_id = $owner_id
            AND id = $group_id
        RETURNING id;
      `,
      { owner_id: ownerId, group_id: groupId, last_activity_at: activityAt },
    );
    return rows.length > 0;
  }
}
