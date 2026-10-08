import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** How many recently opened pages are remembered per user. */
const RECENT_PAGES_KEPT = 20;

/** Owns the personal wiki state of users: favorites, recent pages, tree. */
export class WikiStateRepository {
  private readonly database: DatabaseTransaction;

  /**
   * Creates the repository.
   *
   * @param database - Database access or the transaction to run in.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /**
   * Lists the pages a user marked as favorite.
   *
   * @param userId - Account identifier.
   * @returns Page identifiers, oldest favorite first.
   */
  public async listFavoriteIds(userId: string): Promise<string[]> {
    return this.listIds(
      "SELECT page_id FROM wiki_favorites WHERE user_id = $user_id ORDER BY created_at, page_id;",
      userId,
    );
  }

  /**
   * Lists the pages whose branch a user keeps open in the tree.
   *
   * @param userId - Account identifier.
   * @returns Page identifiers.
   */
  public async listExpandedIds(userId: string): Promise<string[]> {
    return this.listIds(
      "SELECT page_id FROM wiki_expanded_pages WHERE user_id = $user_id ORDER BY page_id;",
      userId,
    );
  }

  /**
   * Lists the pages a user opened last.
   *
   * @param userId - Account identifier.
   * @returns Page identifiers, newest first.
   */
  public async listRecentIds(userId: string): Promise<string[]> {
    return this.listIds(
      "SELECT page_id FROM wiki_recent_pages WHERE user_id = $user_id ORDER BY visited_at DESC, page_id;",
      userId,
    );
  }

  /**
   * Marks or unmarks a favorite.
   *
   * @param userId - Account identifier.
   * @param pageId - Page identifier.
   * @param isFavorite - Whether the page is a favorite afterwards.
   */
  public async setFavorite(
    userId: string,
    pageId: string,
    isFavorite: boolean,
  ): Promise<void> {
    await this.setMembership("wiki_favorites", userId, pageId, isFavorite);
  }

  /**
   * Opens or closes a branch of the tree for a user.
   *
   * @param userId - Account identifier.
   * @param pageId - Page identifier.
   * @param isExpanded - Whether the branch is open afterwards.
   */
  public async setExpanded(
    userId: string,
    pageId: string,
    isExpanded: boolean,
  ): Promise<void> {
    await this.setMembership("wiki_expanded_pages", userId, pageId, isExpanded);
  }

  /**
   * Remembers that a user opened a page.
   *
   * @param userId - Account identifier.
   * @param pageId - Page identifier.
   */
  public async recordVisit(userId: string, pageId: string): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO wiki_recent_pages (
            user_id,
            page_id
        )
        VALUES (
            $user_id,
            $page_id
        )
        ON CONFLICT (user_id, page_id) DO UPDATE SET
            visited_at = utc_now();
      `,
      { page_id: pageId, user_id: userId },
    );
    await this.database.execute(
      `
        DELETE FROM wiki_recent_pages
        WHERE user_id = $user_id
            AND page_id NOT IN (
                SELECT page_id
                FROM wiki_recent_pages
                WHERE user_id = $user_id
                ORDER BY visited_at DESC, page_id
                LIMIT ${RECENT_PAGES_KEPT}
            );
      `,
      { user_id: userId },
    );
  }

  private async listIds(statement: string, userId: string): Promise<string[]> {
    const rows = await this.database.query(statement, { user_id: userId });

    return rows.map((row) => readTextColumn(row, 0, "page_id"));
  }

  private async setMembership(
    table: "wiki_favorites" | "wiki_expanded_pages",
    userId: string,
    pageId: string,
    isMember: boolean,
  ): Promise<void> {
    const parameters = { page_id: pageId, user_id: userId };

    if (isMember) {
      await this.database.execute(
        `
          INSERT INTO ${table} (
              user_id,
              page_id
          )
          VALUES (
              $user_id,
              $page_id
          )
          ON CONFLICT (user_id, page_id) DO NOTHING;
        `,
        parameters,
      );

      return;
    }

    await this.database.execute(
      `DELETE FROM ${table} WHERE user_id = $user_id AND page_id = $page_id;`,
      parameters,
    );
  }
}
