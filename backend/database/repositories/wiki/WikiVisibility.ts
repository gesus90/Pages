import type { SqlParameters } from "@/backend/database/Database";
import type { WikiVisibilityScope } from "@/definition/Wiki";

/** A SQL fragment together with the values its placeholders bind. */
export interface WikiSqlFragment {
  readonly sql: string;
  readonly parameters: SqlParameters;
}

/** Options of {@link createVisiblePagesQuery}. */
export interface VisiblePagesOptions {
  /** Include pages in the trash; used to list what a viewer may restore. */
  readonly includeDeleted?: boolean;
}

/**
 * Builds `column IN (...)` with one placeholder per value.
 *
 * @param column - Trusted column expression.
 * @param prefix - Prefix of the placeholder names.
 * @param values - Values to match.
 * @returns A condition that is false for an empty list.
 */
export function createInCondition(
  column: string,
  prefix: string,
  values: readonly string[],
): WikiSqlFragment {
  if (values.length === 0) {
    return { sql: "FALSE", parameters: {} };
  }

  const parameters = Object.fromEntries(
    values.map((value, index): [string, string] => [
      `${prefix}_${index}`,
      value,
    ]),
  );

  return {
    sql: `${column} IN (${Object.keys(parameters)
      .map((name) => `$${name}`)
      .join(", ")})`,
    parameters,
  };
}

/** Anchors of a page that the viewer cannot satisfy. */
function createAnchorCondition(scope: WikiVisibilityScope): WikiSqlFragment {
  const departments = createInCondition(
    "anchor.target_id",
    "visible_department",
    scope.departmentIds,
  );
  const milestoneProjects = createInCondition(
    "milestone.project_id",
    "visible_milestone_project",
    scope.projectIds,
  );
  const epicProjects = createInCondition(
    "epic.project_id",
    "visible_epic_project",
    scope.projectIds,
  );
  const epicDepartments = createInCondition(
    "epic.department_id",
    "visible_epic_department",
    scope.departmentIds,
  );

  // A target that no longer exists hides the page from everybody except its
  // owner and administrators, who can then remove the anchor.
  const sql = `
    (anchor.kind = 'department' AND (
        $viewer_is_admin = 1 OR ${departments.sql}
    ))
    OR (anchor.kind = 'milestone' AND EXISTS (
        SELECT 1
        FROM milestones AS milestone
        WHERE milestone.id = anchor.target_id
            AND ${milestoneProjects.sql}
    ))
    OR (anchor.kind = 'epic' AND EXISTS (
        SELECT 1
        FROM work_items AS epic
        WHERE epic.id = anchor.target_id
            AND ${epicProjects.sql}
            AND (
                $viewer_is_admin = 1
                OR epic.department_id IS NULL
                OR ${epicDepartments.sql}
            )
    ))
    OR (
        ($viewer_is_admin = 1 OR page.owner_id = $viewer_id)
        AND (
            (anchor.kind = 'department' AND NOT EXISTS (
                SELECT 1 FROM departments WHERE departments.id = anchor.target_id
            ))
            OR (anchor.kind = 'milestone' AND NOT EXISTS (
                SELECT 1 FROM milestones WHERE milestones.id = anchor.target_id
            ))
            OR (anchor.kind = 'epic' AND NOT EXISTS (
                SELECT 1 FROM work_items WHERE work_items.id = anchor.target_id
            ))
        )
    )
  `;

  return {
    sql,
    parameters: {
      ...departments.parameters,
      ...milestoneProjects.parameters,
      ...epicProjects.parameters,
      ...epicDepartments.parameters,
    },
  };
}

/** Whether one page, ignoring its ancestors, is meant for the viewer. */
function createOwnVisibility(
  scope: WikiVisibilityScope,
  options: VisiblePagesOptions,
): WikiSqlFragment {
  const projects = createInCondition(
    "page.project_id",
    "visible_project",
    scope.projectIds,
  );
  const anchors = createAnchorCondition(scope);
  const deleted = options.includeDeleted ? "TRUE" : "page.deleted_at IS NULL";
  const sql = `
    ${deleted}
    AND (
        page.scope = 'instance'
        OR (page.scope = 'project' AND ${projects.sql})
        OR (page.scope = 'private' AND page.owner_id = $viewer_id)
    )
    AND NOT EXISTS (
        SELECT 1
        FROM wiki_page_anchors AS anchor
        WHERE anchor.page_id = page.id
            AND NOT (${anchors.sql})
    )
  `;

  return {
    sql,
    parameters: {
      ...projects.parameters,
      ...anchors.parameters,
      viewer_id: scope.userId,
      viewer_is_admin: scope.isAdmin ? 1 : 0,
    },
  };
}

/**
 * Builds the recursive query that lists the pages a viewer may see.
 *
 * @param scope - What the viewer may see, resolved on the server.
 * @param options - Whether the trash is included.
 * @returns A `WITH RECURSIVE` prefix defining `visible_pages (id)` and its
 * parameters. Every read of pages joins it, so that the filter always acts
 * before ranking, counting and snippets.
 *
 * @remarks
 * A page is listed when it and all of its ancestors are meant for the
 * viewer: the right scope (instance, a readable project, or private to the
 * viewer) and every anchor satisfied. A hidden page therefore hides its whole
 * subtree.
 */
export function createVisiblePagesQuery(
  scope: WikiVisibilityScope,
  options: VisiblePagesOptions = {},
): WikiSqlFragment {
  const own = createOwnVisibility(scope, options);

  return {
    sql: `
      WITH RECURSIVE visible_pages (id) AS (
          SELECT page.id
          FROM wiki_pages AS page
          WHERE page.parent_id IS NULL
              AND ${own.sql}
          UNION ALL
          SELECT page.id
          FROM wiki_pages AS page
          INNER JOIN visible_pages
              ON page.parent_id = visible_pages.id
          WHERE ${own.sql}
      )
    `,
    parameters: own.parameters,
  };
}
