import { deleteWikiPages } from "../wiki/WikiPageDeletion";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Selects every wiki page of the project, the ones in the trash included. */
const PROJECT_WIKI_PAGES =
  "SELECT id FROM wiki_pages WHERE project_id = $project_id";

/**
 * Deletes the wiki of a project for good, without passing through the trash.
 *
 * @param database - The transaction to delete in.
 * @param projectId - The project whose pages go.
 * @returns Storage names of the attachment files that no longer have a row;
 * the caller removes them from the disk after the transaction committed.
 *
 * @remarks
 * Uploads that an agent linked to one of the pages lose their record as well.
 * Everything else that belongs to a page, such as comments, versions and
 * links to the page, goes with {@link deleteWikiPages}.
 */
export async function deleteProjectWiki(
  database: DatabaseTransaction,
  projectId: string,
): Promise<string[]> {
  await database.execute(
    `DELETE FROM agent_assets WHERE page_id IN (${PROJECT_WIKI_PAGES});`,
    { project_id: projectId },
  );

  return deleteWikiPages(database, {
    parameters: { project_id: projectId },
    sql: PROJECT_WIKI_PAGES,
  });
}
