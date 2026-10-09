import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** Keeps which branches of the ticket tree each person opened. */
export class WorkItemTreeRepository {
  private readonly database: Database;

  /**
   * Creates the repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Lists the open branches of a person.
   *
   * @param userId - The person.
   * @returns Keys of the open branches.
   */
  public async findExpandedKeys(userId: string): Promise<string[]> {
    const rows = await this.database.query(
      `
        SELECT node_key
        FROM work_item_tree_expansions
        WHERE user_id = $user_id
        ORDER BY node_key;
      `,
      { user_id: userId },
    );

    return rows.map((row) => readTextColumn(row, 0, "node_key"));
  }

  /**
   * Opens or closes a branch for a person.
   *
   * @param userId - The person.
   * @param nodeKey - Key of the branch.
   * @param isExpanded - Whether the branch is open now.
   */
  public async setExpanded(
    userId: string,
    nodeKey: string,
    isExpanded: boolean,
  ): Promise<void> {
    await this.database.execute(
      isExpanded
        ? `
            INSERT INTO work_item_tree_expansions (
                user_id,
                node_key
            )
            VALUES (
                $user_id,
                $node_key
            )
            ON CONFLICT DO NOTHING;
          `
        : `
            DELETE FROM work_item_tree_expansions
            WHERE user_id = $user_id
                AND node_key = $node_key;
          `,
      { node_key: nodeKey, user_id: userId },
    );
  }

  /**
   * Counts the open branches of a person, to keep the list bounded.
   *
   * @param userId - The person.
   * @returns How many branches are open.
   */
  public async countExpanded(userId: string): Promise<number> {
    const [row = []] = await this.database.query(
      `
        SELECT COUNT(*)
        FROM work_item_tree_expansions
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );

    return readCountColumn(row, 0, "count");
  }
}
