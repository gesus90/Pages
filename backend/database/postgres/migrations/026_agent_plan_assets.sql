-- PAGE-268: files of asset nodes and asset stack entries of agent plans.
-- A row belongs to the project of the plan that uploaded it; reading it needs
-- access to that project, checked on every read. The media type and kind come
-- from the content, never from the name. Results of a node keep their origin.
-- Files are never deleted automatically.
CREATE TABLE agent_plan_assets (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    size BIGINT NOT NULL,
    checksum TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    origin_run_id TEXT,
    origin_step_id TEXT,
    origin_asset_id TEXT,
    created_at TEXT NOT NULL DEFAULT utc_now(),
    PRIMARY KEY (id),
    CHECK (kind IN ('image', 'video', 'audio', 'document', 'archive', 'other'))
);

CREATE INDEX agent_plan_assets_project
    ON agent_plan_assets (project_id, created_at);
