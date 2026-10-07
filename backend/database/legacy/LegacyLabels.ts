import type { DatabaseTransaction } from "@/backend/database/Database";

/** The SQLite table of project-bound labels that no longer exists in DuckDB. */
export const LEGACY_LABEL_TABLE = "project_labels";

/** The columns of {@link LEGACY_LABEL_TABLE} in the former file. */
export const LEGACY_LABEL_COLUMNS = [
  "id",
  "project_id",
  "name",
  "color",
  "created_at",
  "updated_at",
] as const;

/** Creates the former label table inside the transaction, to receive the copy. */
export async function createLegacyLabelTable(
  transaction: DatabaseTransaction,
): Promise<void> {
  await transaction.execute(`
    CREATE TABLE ${LEGACY_LABEL_TABLE} (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
  `);
}

/**
 * Turns the copied project labels into the global catalog.
 *
 * @remarks
 * Applies the rule of migration 013: labels with the same name, ignoring
 * case, merge into the oldest one, which keeps its color, and tickets carry
 * the merged label only once. Expects the former label table and the copied,
 * still unmerged `work_item_labels`; drops the former table afterwards.
 */
export async function mergeLegacyLabels(
  transaction: DatabaseTransaction,
): Promise<void> {
  await transaction.execute(`
    DELETE FROM labels;

    CREATE TEMPORARY TABLE label_merge AS
    SELECT
        id AS old_id,
        FIRST_VALUE(id) OVER (
            PARTITION BY lower(name)
            ORDER BY created_at ASC, id ASC
        ) AS kept_id
    FROM ${LEGACY_LABEL_TABLE};

    INSERT INTO labels (id, name, color, created_at, updated_at)
    SELECT id, name, color, created_at, updated_at
    FROM ${LEGACY_LABEL_TABLE}
    INNER JOIN label_merge
        ON label_merge.kept_id = ${LEGACY_LABEL_TABLE}.id
    WHERE label_merge.old_id = label_merge.kept_id;

    CREATE TEMPORARY TABLE merged_assignments AS
    SELECT
        work_item_labels.work_item_id,
        label_merge.kept_id AS label_id,
        MIN(work_item_labels.assigned_at) AS assigned_at
    FROM work_item_labels
    INNER JOIN label_merge
        ON label_merge.old_id = work_item_labels.label_id
    GROUP BY work_item_labels.work_item_id, label_merge.kept_id;

    DELETE FROM work_item_labels;

    INSERT INTO work_item_labels (work_item_id, label_id, assigned_at)
    SELECT work_item_id, label_id, assigned_at
    FROM merged_assignments;

    DROP TABLE merged_assignments;
    DROP TABLE label_merge;
    DROP TABLE ${LEGACY_LABEL_TABLE};
  `);
}
