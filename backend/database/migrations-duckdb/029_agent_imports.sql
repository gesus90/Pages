CREATE TABLE agent_import_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'partial')),
    snapshot_json TEXT NOT NULL,
    created_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    conflict_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    finished_at BIGINT
);

CREATE TABLE agent_import_sources (
    project_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    target_revision INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    last_run_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (project_id, source_key)
);

CREATE TABLE agent_import_items (
    run_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    target_key TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('created', 'skipped', 'conflict', 'failed')),
    target_id TEXT,
    error_code TEXT,
    result_json TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (run_id, source_key)
);

CREATE INDEX agent_import_sources_target ON agent_import_sources (target_kind, target_id);
CREATE INDEX agent_import_runs_project ON agent_import_runs (project_id, created_at);
