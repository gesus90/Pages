import { createInCondition } from "./WikiVisibility";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Owns the records of who is mentioned where. */
export class WikiMentionRepository {
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
   * Makes the mentions of a text exactly the given people.
   *
   * @param source - Page, comment (empty for the page text) and author.
   * @param userIds - The mentioned accounts.
   */
  public async replace(
    source: {
      readonly pageId: string;
      readonly commentId: string;
      readonly authorId: string;
    },
    userIds: readonly string[],
  ): Promise<void> {
    const keep = createInCondition("user_id", "keep", userIds);

    await this.database.execute(
      `
        DELETE FROM wiki_mentions
        WHERE page_id = $page_id
            AND comment_id = $comment_id
            AND NOT (${keep.sql});
      `,
      {
        ...keep.parameters,
        comment_id: source.commentId,
        page_id: source.pageId,
      },
    );

    for (const userId of userIds) {
      await this.database.execute(
        `
          INSERT INTO wiki_mentions (
              page_id,
              comment_id,
              user_id,
              created_by
          )
          VALUES (
              $page_id,
              $comment_id,
              $user_id,
              $created_by
          )
          ON CONFLICT (page_id, comment_id, user_id) DO NOTHING;
        `,
        {
          comment_id: source.commentId,
          created_by: source.authorId,
          page_id: source.pageId,
          user_id: userId,
        },
      );
    }
  }
}
