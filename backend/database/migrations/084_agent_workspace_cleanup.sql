CREATE TABLE agent_workspace_cleanup (
    workspace_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    removed_by TEXT NOT NULL,
    workspace_name TEXT NOT NULL,
    requested_at TEXT NOT NULL DEFAULT utc_now(),
    updated_at TEXT NOT NULL DEFAULT utc_now(),
    state TEXT NOT NULL DEFAULT 'pending',
    blocker TEXT NOT NULL DEFAULT 'cleanup_requested',
    PRIMARY KEY (workspace_id, run_id)
);
