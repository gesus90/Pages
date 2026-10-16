-- Baseline schema of the DuckDB database.
--
-- It is the final shape of the fifteen SQLite migrations in
-- `backend/database/migrations/`, which stay frozen as the source of the
-- one-time data transfer (`scripts/migrate-sqlite-to-duckdb.ts`).
--
-- DuckDB specifics that shape this file:
--   * Timestamps are TEXT in `YYYY-MM-DD HH:MM:SS` (UTC). `utc_now()` and
--     `utc_after(interval)` are macros `Database.create` installs; they
--     replace CURRENT_TIMESTAMP and SQLite's datetime(...) offsets.
--   * Flags are INTEGER 0/1, all other whole numbers are BIGINT like SQLite's
--     64-bit integers.
--   * There are no FOREIGN KEY constraints. DuckDB executes an UPDATE of an
--     indexed column as DELETE plus INSERT and then rejects it while child
--     rows exist, which would break renaming labels, changing usernames or
--     reassigning work items. It also has no ON DELETE actions. The services
--     validate references instead, and rows are archived rather than deleted.
--   * There are no secondary indexes: PRIMARY KEY and UNIQUE constraints are
--     the only indexes. For the data volume of a team, DuckDB's column
--     scans are fast enough, and indexes would only add the UPDATE cost above.

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT NOT NULL CHECK (
        role IN ('admin', 'manager', 'employee')
    ),
    is_active INTEGER NOT NULL DEFAULT 1,
    avatar_type TEXT NOT NULL DEFAULT 'initials' CHECK (
        avatar_type IN ('initials', 'icon', 'image')
    ),
    avatar_icon TEXT,
    avatar_color TEXT,
    avatar_image_url TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE user_avatars (
    user_id TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE user_settings (
    user_id TEXT PRIMARY KEY,
    language TEXT NOT NULL DEFAULT 'de' CHECK (
        language IN ('de', 'en')
    ),
    timezone TEXT,
    date_format TEXT CHECK (
        date_format IN ('DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD')
    ),
    week_start TEXT CHECK (
        week_start IN ('monday', 'sunday')
    ),
    notify_email INTEGER CHECK (
        notify_email IN (0, 1)
    ),
    notify_desktop INTEGER CHECK (
        notify_desktop IN (0, 1)
    ),
    notify_mentions INTEGER CHECK (
        notify_mentions IN (0, 1)
    ),
    notify_assignments INTEGER CHECK (
        notify_assignments IN (0, 1)
    ),
    notify_due_dates INTEGER CHECK (
        notify_due_dates IN (0, 1)
    ),
    notify_weekly_summary INTEGER CHECK (
        notify_weekly_summary IN (0, 1)
    ),
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    expires_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    owner_id TEXT NOT NULL,
    parent_id TEXT,
    manager_id TEXT,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (
        status IN ('planned', 'active', 'paused', 'completed')
    ),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (
        progress BETWEEN 0 AND 100
    ),
    placeholder_color TEXT NOT NULL DEFAULT '#FCE3D3',
    start_date TEXT,
    target_date TEXT,
    notes TEXT NOT NULL DEFAULT '',
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE project_keys (
    project_id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE
);

CREATE TABLE project_icons (
    project_id TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE project_members (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (
        role IN ('manager', 'member', 'viewer')
    ),
    joined_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (project_id, user_id)
);

CREATE TABLE project_goals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    is_done INTEGER NOT NULL DEFAULT 0 CHECK (
        is_done IN (0, 1)
    ),
    position BIGINT NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE project_tags (
    project_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (project_id, tag)
);

CREATE TABLE project_events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL,
    event_time TEXT,
    type TEXT NOT NULL DEFAULT 'general',
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE project_activity (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK (
        category IN ('tasks', 'planning', 'team', 'integrations', 'project')
    ),
    action TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE project_integrations (
    project_id TEXT PRIMARY KEY,
    repo_url TEXT NOT NULL DEFAULT '',
    repo_name TEXT,
    token_hash TEXT,
    token_encrypted TEXT,
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
    sync_interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (
        sync_interval_minutes IN (0, 5, 15, 30, 60)
    ),
    is_connected INTEGER NOT NULL DEFAULT 0 CHECK (
        is_connected IN (0, 1)
    ),
    last_sync_at TEXT,
    next_sync_at TEXT,
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE workflow_statuses (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    position BIGINT NOT NULL DEFAULT 0,
    is_done INTEGER NOT NULL DEFAULT 0 CHECK (
        is_done IN (0, 1)
    )
);

CREATE TABLE milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'completed', 'archived')
    ),
    color_key TEXT,
    icon_key TEXT,
    color_custom TEXT,
    start_at TEXT,
    due_at TEXT,
    completed_at TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE milestone_dependencies (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    link_type TEXT NOT NULL CHECK (
        link_type IN ('prerequisite', 'follows', 'blocks', 'relates_to')
    ),
    created_at TEXT NOT NULL DEFAULT utc_now(),
    UNIQUE (source_id, target_id, link_type)
);

CREATE TABLE work_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    number BIGINT NOT NULL,
    type TEXT NOT NULL CHECK (
        type IN ('initiative', 'epic', 'task', 'subtask')
    ),
    parent_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status_id TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (
        priority IN ('low', 'normal', 'high', 'urgent')
    ),
    assignee_id TEXT,
    created_by TEXT NOT NULL,
    milestone_id TEXT,
    start_at TEXT,
    due_at TEXT,
    sort_order BIGINT NOT NULL DEFAULT 0,
    completed_at TEXT,
    archived_at TEXT,
    github_issue_number BIGINT,
    github_issue_url TEXT,
    github_issue_state TEXT CHECK (
        github_issue_state IN ('open', 'closed')
    ),
    github_issue_updated_at TEXT,
    github_content_hash TEXT,
    github_conflict INTEGER NOT NULL DEFAULT 0 CHECK (
        github_conflict IN (0, 1)
    ),
    github_last_sync_at TEXT,
    github_last_error TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE work_item_history (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE work_item_checklist_items (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    title TEXT NOT NULL,
    is_done INTEGER NOT NULL DEFAULT 0,
    sort_order BIGINT NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE work_item_links (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    linked_work_item_id TEXT NOT NULL,
    link_type TEXT NOT NULL CHECK (
        link_type IN ('blocks', 'relates_to', 'duplicates')
    ),
    created_at TEXT NOT NULL DEFAULT utc_now(),
    UNIQUE (work_item_id, linked_work_item_id, link_type)
);

CREATE TABLE project_labels (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6b7280',
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    UNIQUE (project_id, name)
);

CREATE TABLE work_item_labels (
    work_item_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (work_item_id, label_id)
);

CREATE TABLE github_external_issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    issue_number BIGINT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open' CHECK (
        state IN ('open', 'closed')
    ),
    dismissed INTEGER NOT NULL DEFAULT 0 CHECK (
        dismissed IN (0, 1)
    ),
    imported_work_item_id TEXT,
    detected_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    UNIQUE (project_id, issue_number)
);

CREATE TABLE github_pull_requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    number BIGINT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open' CHECK (
        state IN ('open', 'closed')
    ),
    merged INTEGER NOT NULL DEFAULT 0 CHECK (
        merged IN (0, 1)
    ),
    branch TEXT,
    work_item_id TEXT,
    synced_at TEXT NOT NULL DEFAULT utc_now(),
    UNIQUE (project_id, number)
);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    assignee_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'in_progress', 'completed')
    ),
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE TABLE wiki_pages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now()
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
