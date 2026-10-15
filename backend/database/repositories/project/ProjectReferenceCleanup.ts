import { readTextColumn } from "@/backend/database/RowValue";
import { BOARD_FILTER_ALL } from "@/definition/BoardPreferences";

import type { DatabaseTransaction } from "@/backend/database/Database";

const PROJECT_MILESTONES =
  "SELECT id FROM milestones WHERE project_id = $project_id";
const PROJECT_WORK_ITEMS =
  "SELECT id FROM work_items WHERE project_id = $project_id";

/** The board filters of one person after the references to a deleted project were released. */
export interface ReleasedBoardPreferences {
  readonly userId: string;
  /** Serialized preferences in which the filters no longer name the project or its milestones. */
  readonly preferences: string;
}

/** Reads stored board filters, or `null` when the text is not a JSON object. */
function parseBoardPreferences(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    return { ...parsed };
  } catch {
    return null;
  }
}

/** Lets the board show everything again wherever a filter names a deleted project or milestone. */
function releaseFilters(
  preferences: Record<string, unknown>,
  projectId: string,
  milestoneIds: ReadonlySet<string>,
): boolean {
  let isReleased = false;
  if (preferences.project === projectId) {
    preferences.project = BOARD_FILTER_ALL;
    isReleased = true;
  }
  if (
    typeof preferences.milestone === "string" &&
    milestoneIds.has(preferences.milestone)
  ) {
    preferences.milestone = BOARD_FILTER_ALL;
    isReleased = true;
  }
  return isReleased;
}

/**
 * Finds the people whose saved board filters name a project or one of its milestones.
 *
 * @param database - The transaction to read in.
 * @param projectId - The project about to be deleted.
 * @returns The preferences to store instead, one entry per affected person.
 */
export async function findReleasedBoardPreferences(
  database: DatabaseTransaction,
  projectId: string,
): Promise<ReleasedBoardPreferences[]> {
  const milestones = await database.query(`${PROJECT_MILESTONES};`, {
    project_id: projectId,
  });
  const milestoneIds = new Set(
    milestones.map((row) => readTextColumn(row, 0, "id")),
  );
  const rows = await database.query(
    "SELECT user_id, preferences FROM user_board_preferences ORDER BY user_id;",
  );
  const released: ReleasedBoardPreferences[] = [];
  for (const row of rows) {
    const preferences = parseBoardPreferences(
      readTextColumn(row, 1, "preferences"),
    );
    if (preferences === null) continue;
    if (!releaseFilters(preferences, projectId, milestoneIds)) continue;
    released.push({
      userId: readTextColumn(row, 0, "user_id"),
      preferences: JSON.stringify(preferences),
    });
  }
  return released;
}

/**
 * Clears the references that other objects hold to a project, its milestones and its tickets.
 *
 * @param database - The transaction to delete in.
 * @param projectId - The project that is about to go.
 *
 * @remarks
 * Must run before the project rows are removed, because the selections still
 * read them. The shared objects behind these references, such as ticket
 * templates, wiki pages of the instance and the people's board settings,
 * stay; only their link to the project is cut.
 */
export async function clearProjectReferences(
  database: DatabaseTransaction,
  projectId: string,
): Promise<void> {
  const parameters = { project_id: projectId };
  await database.execute(
    "DELETE FROM work_item_template_projects WHERE project_id = $project_id;",
    parameters,
  );
  // Instance and private pages may anchor to the milestones and epics of any
  // project they can read; the anchors of project pages go with those pages.
  await database.execute(
    `
      DELETE FROM wiki_page_anchors
      WHERE (kind = 'milestone' AND target_id IN (${PROJECT_MILESTONES}))
          OR (kind = 'epic' AND target_id IN (${PROJECT_WORK_ITEMS}));
    `,
    parameters,
  );
  // Links to tickets name the ticket key, which a later project could reuse.
  await database.execute(
    `
      DELETE FROM wiki_page_links
      WHERE target_kind = 'ticket'
          AND target_id IN (
              SELECT upper(key) FROM work_items WHERE project_id = $project_id
          );
    `,
    parameters,
  );
  await database.execute(
    `
      DELETE FROM milestone_dependencies
      WHERE source_id IN (${PROJECT_MILESTONES})
          OR target_id IN (${PROJECT_MILESTONES});
    `,
    parameters,
  );
  for (const entry of await findReleasedBoardPreferences(database, projectId)) {
    await database.execute(
      `
        UPDATE user_board_preferences
        SET preferences = $preferences,
            updated_at = utc_now()
        WHERE user_id = $user_id;
      `,
      { preferences: entry.preferences, user_id: entry.userId },
    );
  }
}
