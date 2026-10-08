import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isWikiAnchorKind } from "@/definition/Wiki";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { WikiAnchor, WikiAnchorKind } from "@/definition/Wiki";

/** Owns the anchors that tie a page to departments, milestones and epics. */
export class WikiAnchorRepository {
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
   * Replaces the anchors of a page.
   *
   * @param id - Page identifier.
   * @param anchors - The anchors the page has afterwards.
   */
  public async replaceAnchors(
    id: string,
    anchors: readonly WikiAnchor[],
  ): Promise<void> {
    await this.database.execute(
      "DELETE FROM wiki_page_anchors WHERE page_id = $page_id;",
      { page_id: id },
    );

    for (const anchor of anchors) {
      await this.database.execute(
        `
          INSERT INTO wiki_page_anchors (
              page_id,
              kind,
              target_id
          )
          VALUES (
              $page_id,
              $kind,
              $target_id
          );
        `,
        { kind: anchor.kind, page_id: id, target_id: anchor.targetId },
      );
    }
  }

  /**
   * Reads the anchors of a page with the name of each target.
   *
   * @param id - Page identifier.
   * @returns The anchors; a vanished target has no label.
   */
  public async findAnchors(
    id: string,
  ): Promise<
    { kind: WikiAnchorKind; targetId: string; label: string | null }[]
  > {
    const rows = await this.database.query(
      `
        SELECT
            anchor.kind,
            anchor.target_id,
            COALESCE(department.name, milestone.name, epic.title)
        FROM wiki_page_anchors AS anchor
        LEFT JOIN departments AS department
            ON anchor.kind = 'department' AND department.id = anchor.target_id
        LEFT JOIN milestones AS milestone
            ON anchor.kind = 'milestone' AND milestone.id = anchor.target_id
        LEFT JOIN work_items AS epic
            ON anchor.kind = 'epic' AND epic.id = anchor.target_id
        WHERE anchor.page_id = $page_id
        ORDER BY anchor.kind, anchor.target_id;
      `,
      { page_id: id },
    );

    return rows.map((row) => ({
      kind: readAnchorKind(readTextColumn(row, 0, "kind")),
      label: readNullableTextColumn(row, 2, "label"),
      targetId: readTextColumn(row, 1, "target_id"),
    }));
  }

  /**
   * Removes the anchors of the given kinds from a page and everything below.
   *
   * @param id - Page identifier at the top of the subtree.
   * @param kinds - Anchor kinds to remove.
   */
  public async removeAnchorsOfSubtree(
    id: string,
    kinds: readonly WikiAnchorKind[],
  ): Promise<void> {
    for (const kind of kinds) {
      await this.database.execute(
        `
          DELETE FROM wiki_page_anchors
          WHERE kind = $kind
              AND page_id IN (
                  WITH RECURSIVE subtree (id) AS (
                      SELECT page.id
                      FROM wiki_pages AS page
                      WHERE page.id = $page_id
                      UNION ALL
                      SELECT page.id
                      FROM wiki_pages AS page
                      INNER JOIN subtree
                          ON page.parent_id = subtree.id
                  )
                  SELECT id FROM subtree
              );
        `,
        { kind, page_id: id },
      );
    }
  }

  /**
   * Looks up the target of an anchor.
   *
   * @param kind - Kind of the anchor.
   * @param targetId - Identifier of the department, milestone or epic.
   * @returns Where the target belongs, or `null` when it does not exist.
   */
  public async findAnchorTarget(
    kind: WikiAnchorKind,
    targetId: string,
  ): Promise<{ projectId: string | null; departmentId: string | null } | null> {
    const statements: Record<WikiAnchorKind, string> = {
      department: "SELECT NULL, id FROM departments WHERE id = $target_id;",
      epic: "SELECT project_id, department_id FROM work_items WHERE id = $target_id AND type = 'epic';",
      milestone:
        "SELECT project_id, NULL FROM milestones WHERE id = $target_id;",
    };
    const rows = await this.database.query(statements[kind], {
      target_id: targetId,
    });
    const row = rows[0];

    return row
      ? {
          departmentId: readNullableTextColumn(row, 1, "department_id"),
          projectId: readNullableTextColumn(row, 0, "project_id"),
        }
      : null;
  }
}

function readAnchorKind(kind: string): WikiAnchorKind {
  if (!isWikiAnchorKind(kind)) {
    throw new Error('Database returned an invalid value for "kind".');
  }

  return kind;
}
