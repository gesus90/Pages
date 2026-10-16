-- Administration is instance-wide rather than attached to a single project.
-- Changes, their source and the public result share the mutation transaction.
CREATE TABLE administration_activity (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('mcp', 'ai')),
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    changes_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT utc_now()
);

CREATE INDEX administration_activity_created_at
    ON administration_activity (created_at);
