import { readTextColumn } from "@/backend/database/RowValue";
import { deleteAssistantConversations } from "../assistant/AssistantConversationDeletion";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Selects the tickets of the project, subtickets and archived ones included. */
const PROJECT_WORK_ITEMS =
  "SELECT id FROM work_items WHERE project_id = $project_id";

/** Tables with exactly one row set per ticket. */
const WORK_ITEM_OWNED_TABLES = [
  "work_item_history",
  "work_item_checklist_items",
  "work_item_checklist_revisions",
  "work_item_labels",
  "work_item_attachments",
] as const;

/**
 * Deletes everything that hangs on the tickets of a project, but not the tickets.
 *
 * @param database - The transaction to delete in.
 * @param projectId - The project whose tickets lose their data.
 * @returns Storage names of the attachment files that no longer have a row;
 * the caller removes them from the disk after the transaction committed.
 *
 * @remarks
 * Links to tickets of other projects go as well, because a link cannot
 * outlive one of its ends. The tickets themselves are removed with the
 * project rows afterwards, so the subqueries here still find them.
 */
export async function deleteProjectWorkItemData(
  database: DatabaseTransaction,
  projectId: string,
): Promise<string[]> {
  const parameters = { project_id: projectId };
  const files = await database.query(
    `
      SELECT storage_name
      FROM work_item_attachments
      WHERE work_item_id IN (${PROJECT_WORK_ITEMS});
    `,
    parameters,
  );

  await deleteAssistantConversations(database, {
    condition: `context_kind = 'ticket' AND context_id IN (${PROJECT_WORK_ITEMS})`,
    parameters,
  });
  for (const table of WORK_ITEM_OWNED_TABLES) {
    await database.execute(
      `DELETE FROM ${table} WHERE work_item_id IN (${PROJECT_WORK_ITEMS});`,
      parameters,
    );
  }
  await database.execute(
    `
      DELETE FROM work_item_links
      WHERE work_item_id IN (${PROJECT_WORK_ITEMS})
          OR linked_work_item_id IN (${PROJECT_WORK_ITEMS});
    `,
    parameters,
  );
  await database.execute(
    `
      DELETE FROM milestone_initiatives
      WHERE initiative_id IN (${PROJECT_WORK_ITEMS})
          OR milestone_id IN (
              SELECT id FROM milestones WHERE project_id = $project_id
          );
    `,
    parameters,
  );
  await database.execute(
    `DELETE FROM work_item_tree_expansions WHERE node_key IN (${PROJECT_WORK_ITEMS});`,
    parameters,
  );

  return files.map((row) => readTextColumn(row, 0, "storage_name"));
}
