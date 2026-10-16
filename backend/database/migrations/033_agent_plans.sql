CREATE TABLE agent_plans (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    usage TEXT NOT NULL CHECK (usage IN ('private', 'workspace')),
    revision INTEGER NOT NULL DEFAULT 1,
    plan_json TEXT NOT NULL
);

CREATE TABLE agent_plan_runs (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    status TEXT NOT NULL,
    view_json TEXT NOT NULL,
    snapshot_json TEXT NOT NULL
);

CREATE TABLE agent_plan_workspace_locks (
    workspace_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL
);
