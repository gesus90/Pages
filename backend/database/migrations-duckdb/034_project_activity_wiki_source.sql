CREATE TABLE project_activity_next (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK (
        category IN ('tasks', 'planning', 'team', 'integrations', 'project', 'wiki')
    ),
    action TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    work_item_id TEXT,
    wiki_page_id TEXT,
    source TEXT NOT NULL DEFAULT 'ui' CHECK (
        source IN ('ui', 'mcp', 'ai')
    )
);

INSERT INTO project_activity_next (
    id,
    project_id,
    user_id,
    category,
    action,
    message,
    created_at,
    work_item_id,
    source
)
SELECT
    id,
    project_id,
    user_id,
    category,
    action,
    message,
    created_at,
    work_item_id,
    'ui'
FROM project_activity;

DROP TABLE project_activity;
ALTER TABLE project_activity_next RENAME TO project_activity;
CREATE INDEX project_activity_work_item_id ON project_activity (work_item_id);
