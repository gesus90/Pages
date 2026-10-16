-- Labels are one catalog for the whole instance instead of one per project.
-- Names are unique ignoring case. Project labels with the same name (ignoring
-- case) are merged into the oldest one, which keeps its color; the tickets of
-- the merged labels move to it and carry it only once.
CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6b7280',
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE UNIQUE INDEX labels_name_lower ON labels (lower(name));

CREATE TABLE label_merge (
    old_id TEXT NOT NULL,
    kept_id TEXT NOT NULL
);

INSERT INTO label_merge (
    old_id,
    kept_id
)
SELECT
    id,
    FIRST_VALUE(id) OVER (
        PARTITION BY lower(name)
        ORDER BY created_at ASC, id ASC
    )
FROM project_labels;

INSERT INTO labels (
    id,
    name,
    color,
    created_at,
    updated_at
)
SELECT
    project_labels.id,
    project_labels.name,
    project_labels.color,
    project_labels.created_at,
    project_labels.updated_at
FROM project_labels
INNER JOIN label_merge
    ON label_merge.kept_id = project_labels.id
WHERE label_merge.old_id = label_merge.kept_id;

CREATE TABLE work_item_labels_global (
    work_item_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (work_item_id, label_id)
);

INSERT INTO work_item_labels_global (
    work_item_id,
    label_id,
    assigned_at
)
SELECT
    work_item_labels.work_item_id,
    label_merge.kept_id,
    MIN(work_item_labels.assigned_at)
FROM work_item_labels
INNER JOIN label_merge
    ON label_merge.old_id = work_item_labels.label_id
GROUP BY work_item_labels.work_item_id, label_merge.kept_id;

DROP TABLE work_item_labels;

ALTER TABLE work_item_labels_global RENAME TO work_item_labels;

DROP TABLE label_merge;

DROP TABLE project_labels;
