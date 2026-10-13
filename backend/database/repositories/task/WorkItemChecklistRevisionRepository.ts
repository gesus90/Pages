import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** Keeps the monotonic revision of each ticket checklist next to the content it was taken from. */
export class WorkItemChecklistRevisionRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /**
   * Returns the revision of the checklist as it is now.
   *
   * @param workItemId - The ticket.
   * @param contentHash - The hash of the checklist content just read.
   * @returns The stored revision, one higher when the content changed since it was stored.
   */
  public async current(
    workItemId: string,
    contentHash: string,
  ): Promise<number> {
    const [row] = await this.database.query(
      `
      SELECT
          CAST(revision AS TEXT),
          content_hash
      FROM work_item_checklist_revisions
      WHERE work_item_id = $work_item_id;
    `,
      { work_item_id: workItemId },
    );
    if (!row) return this.store(workItemId, 1, contentHash);
    const revision = Number(readTextColumn(row, 0, "revision"));
    return readTextColumn(row, 1, "content_hash") === contentHash
      ? revision
      : this.store(workItemId, revision + 1, contentHash);
  }

  /**
   * Records a change made through the agent API; the revision always grows.
   *
   * @returns The new revision.
   */
  public async advance(
    workItemId: string,
    contentHash: string,
  ): Promise<number> {
    const [row] = await this.database.query(
      "SELECT CAST(revision AS TEXT) FROM work_item_checklist_revisions WHERE work_item_id = $work_item_id;",
      { work_item_id: workItemId },
    );
    const revision = row ? Number(readTextColumn(row, 0, "revision")) : 0;
    return this.store(workItemId, revision + 1, contentHash);
  }

  private async store(
    workItemId: string,
    revision: number,
    contentHash: string,
  ): Promise<number> {
    await this.database.execute(
      `
      INSERT INTO work_item_checklist_revisions (
          work_item_id,
          revision,
          content_hash
      ) VALUES (
          $work_item_id,
          $revision,
          $content_hash
      )
      ON CONFLICT (work_item_id) DO UPDATE SET
          revision = excluded.revision,
          content_hash = excluded.content_hash;
    `,
      {
        work_item_id: workItemId,
        revision,
        content_hash: contentHash,
      },
    );
    return revision;
  }
}
