-- Project-wide labels for work items, plus a start date and a persisted
-- GitHub synchronization error on tickets. Labels live in the project
-- catalog; tickets reference them without duplicating names or colors.
ALTER TABLE work_items ADD COLUMN start_at TEXT;

ALTER TABLE work_items ADD COLUMN github_last_error TEXT;

CREATE TABLE project_labels (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects (id),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6b7280',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, name)
);

CREATE INDEX idx_project_labels_project ON project_labels (project_id);

CREATE TABLE work_item_labels (
    work_item_id TEXT NOT NULL REFERENCES work_items (id),
    label_id TEXT NOT NULL REFERENCES project_labels (id),
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (work_item_id, label_id)
);

CREATE INDEX idx_work_item_labels_item ON work_item_labels (work_item_id);
CREATE INDEX idx_work_item_labels_label ON work_item_labels (label_id);
