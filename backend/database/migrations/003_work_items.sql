CREATE TABLE workflow_statuses (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects (id),
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    is_done INTEGER NOT NULL DEFAULT 0 CHECK (
        is_done IN (0, 1)
    )
);

INSERT INTO workflow_statuses (
    id,
    project_id,
    key,
    name,
    position,
    is_done
)
VALUES
    ('status-backlog', NULL, 'backlog', 'Backlog', 1, 0),
    ('status-todo', NULL, 'todo', 'To Do', 2, 0),
    ('status-in-progress', NULL, 'in_progress', 'In Arbeit', 3, 0),
    ('status-review', NULL, 'review', 'Review', 4, 0),
    ('status-done', NULL, 'done', 'Done', 5, 1);

CREATE TABLE milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects (id),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'completed', 'archived')
    ),
    start_at TEXT,
    due_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    archived_at TEXT
);

CREATE TABLE project_keys (
    project_id TEXT PRIMARY KEY REFERENCES projects (id),
    key TEXT NOT NULL UNIQUE
);

CREATE TABLE work_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects (id),
    key TEXT NOT NULL UNIQUE,
    number INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (
        type IN ('epic', 'task', 'subtask')
    ),
    parent_id TEXT REFERENCES work_items (id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status_id TEXT NOT NULL REFERENCES workflow_statuses (id),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (
        priority IN ('low', 'normal', 'high', 'urgent')
    ),
    assignee_id TEXT REFERENCES users (id),
    created_by TEXT NOT NULL REFERENCES users (id),
    milestone_id TEXT REFERENCES milestones (id),
    due_at TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    archived_at TEXT
);

CREATE INDEX idx_work_items_project ON work_items (project_id);
CREATE INDEX idx_work_items_parent ON work_items (parent_id);
CREATE INDEX idx_work_items_status ON work_items (status_id);
CREATE INDEX idx_work_items_assignee ON work_items (assignee_id);

CREATE TABLE work_item_history (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items (id),
    user_id TEXT NOT NULL REFERENCES users (id),
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_work_item_history_item ON work_item_history (work_item_id);
