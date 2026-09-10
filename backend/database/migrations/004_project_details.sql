ALTER TABLE projects ADD COLUMN manager_id TEXT REFERENCES users (id);
ALTER TABLE projects ADD COLUMN start_date TEXT;
ALTER TABLE projects ADD COLUMN target_date TEXT;
ALTER TABLE projects ADD COLUMN notes TEXT NOT NULL DEFAULT '';

ALTER TABLE project_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (
    role IN ('manager', 'member', 'viewer')
);

CREATE TABLE project_goals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects (id),
    title TEXT NOT NULL,
    is_done INTEGER NOT NULL DEFAULT 0 CHECK (
        is_done IN (0, 1)
    ),
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_project_goals_project ON project_goals (project_id);

CREATE TABLE project_tags (
    project_id TEXT NOT NULL REFERENCES projects (id),
    tag TEXT NOT NULL,
    PRIMARY KEY (project_id, tag)
);

CREATE TABLE project_events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects (id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL,
    event_time TEXT,
    type TEXT NOT NULL DEFAULT 'general',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at TEXT
);

CREATE INDEX idx_project_events_project ON project_events (project_id);

CREATE TABLE project_integrations (
    project_id TEXT PRIMARY KEY REFERENCES projects (id),
    repo_url TEXT NOT NULL DEFAULT '',
    token_hash TEXT,
    has_token INTEGER NOT NULL DEFAULT 0 CHECK (
        has_token IN (0, 1)
    ),
    sync_issues INTEGER NOT NULL DEFAULT 1 CHECK (
        sync_issues IN (0, 1)
    ),
    sync_status INTEGER NOT NULL DEFAULT 1 CHECK (
        sync_status IN (0, 1)
    ),
    sync_comments INTEGER NOT NULL DEFAULT 1 CHECK (
        sync_comments IN (0, 1)
    ),
    sync_pull_requests INTEGER NOT NULL DEFAULT 0 CHECK (
        sync_pull_requests IN (0, 1)
    ),
    sync_commits INTEGER NOT NULL DEFAULT 0 CHECK (
        sync_commits IN (0, 1)
    ),
    sync_direction TEXT NOT NULL DEFAULT 'bidirectional' CHECK (
        sync_direction IN ('bidirectional', 'push', 'pull')
    ),
    is_connected INTEGER NOT NULL DEFAULT 0 CHECK (
        is_connected IN (0, 1)
    ),
    repo_name TEXT,
    last_sync_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE project_activity (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects (id),
    user_id TEXT NOT NULL REFERENCES users (id),
    category TEXT NOT NULL CHECK (
        category IN ('tasks', 'planning', 'team', 'integrations', 'project')
    ),
    action TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_project_activity_project ON project_activity (project_id);
