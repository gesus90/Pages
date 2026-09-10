-- SQLite cannot alter a CHECK constraint, so work_items is rebuilt to
-- support initiatives and to persist the GitHub synchronization state.
CREATE TABLE work_items_new (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects (id),
    key TEXT NOT NULL UNIQUE,
    number INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (
        type IN ('initiative', 'epic', 'task', 'subtask')
    ),
    parent_id TEXT REFERENCES work_items_new (id),
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
    archived_at TEXT,
    github_issue_number INTEGER,
    github_issue_url TEXT,
    github_issue_state TEXT CHECK (
        github_issue_state IS NULL
        OR github_issue_state IN ('open', 'closed')
    ),
    github_issue_updated_at TEXT,
    github_content_hash TEXT,
    github_conflict INTEGER NOT NULL DEFAULT 0 CHECK (
        github_conflict IN (0, 1)
    ),
    github_last_sync_at TEXT
);

INSERT INTO work_items_new (
    id,
    project_id,
    key,
    number,
    type,
    parent_id,
    title,
    description,
    status_id,
    priority,
    assignee_id,
    created_by,
    milestone_id,
    due_at,
    sort_order,
    created_at,
    updated_at,
    completed_at,
    archived_at
)
SELECT
    id,
    project_id,
    key,
    number,
    type,
    parent_id,
    title,
    description,
    status_id,
    priority,
    assignee_id,
    created_by,
    milestone_id,
    due_at,
    sort_order,
    created_at,
    updated_at,
    completed_at,
    archived_at
FROM work_items;

DROP TABLE work_items;

ALTER TABLE work_items_new RENAME TO work_items;

CREATE INDEX idx_work_items_project ON work_items (project_id);
CREATE INDEX idx_work_items_parent ON work_items (parent_id);
CREATE INDEX idx_work_items_status ON work_items (status_id);
CREATE INDEX idx_work_items_assignee ON work_items (assignee_id);
CREATE INDEX idx_work_items_github_issue ON work_items (github_issue_number);

ALTER TABLE project_integrations ADD COLUMN sync_interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (
    sync_interval_minutes IN (0, 5, 15, 30, 60)
);
ALTER TABLE project_integrations ADD COLUMN next_sync_at TEXT;
ALTER TABLE project_integrations ADD COLUMN token_encrypted TEXT;

-- GitHub issues without a Pages counterpart stay visible until they are
-- imported, linked to an existing task, or explicitly ignored.
CREATE TABLE github_external_issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects (id),
    issue_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open' CHECK (
        state IN ('open', 'closed')
    ),
    dismissed INTEGER NOT NULL DEFAULT 0 CHECK (
        dismissed IN (0, 1)
    ),
    imported_work_item_id TEXT REFERENCES work_items (id),
    detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, issue_number)
);

CREATE INDEX idx_github_external_issues_project
    ON github_external_issues (project_id);

-- Pull requests never become tasks on their own; they can only be assigned
-- to an existing work item for reference.
CREATE TABLE github_pull_requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects (id),
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open' CHECK (
        state IN ('open', 'closed')
    ),
    merged INTEGER NOT NULL DEFAULT 0 CHECK (
        merged IN (0, 1)
    ),
    branch TEXT,
    work_item_id TEXT REFERENCES work_items (id),
    synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, number)
);

CREATE INDEX idx_github_pull_requests_project
    ON github_pull_requests (project_id);
CREATE INDEX idx_github_pull_requests_work_item
    ON github_pull_requests (work_item_id);
